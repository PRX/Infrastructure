# Invoked by: TBD
# Returns: Error or status message
#
#  Make an ASG the perfect size for an ECS cluster

import json
import re
import os
import boto3
import datetime

session = boto3.session.Session()
asg_client = session.client(service_name='autoscaling')
ec2_client = session.client(service_name='ec2')
ecs_client = session.client(service_name='ecs')
sns_client = session.client(service_name='sns')

EMPTY_SLOTS = 2
ECS_AGENT_WAIT = 300
SLACK_CHANNEL = '#ops-debug'
SLACK_ICON = ':ops-autoscaling:'

# encode disconnect timestamps into a tag on the cluster
DISCONNECTS_TAG = 'ecs-asg-sizer:disconnects'
DISCONNECTS_DELIMITER = ' '
DISCONNECTS_SEPARATOR = ':'
DISCONNECT_THRESHOLD_SECONDS = 300

def lambda_handler(event, context):
    ASG_NAME = get_env('ASG_NAME')
    ECS_CLUSTER = get_env('ECS_CLUSTER')
    DRY_RUN = get_env('DRY_RUN', False)
    SLACK_SNS_TOPIC = get_env('SLACK_SNS_TOPIC', False)
    ENV_NAME = get_env_name(ASG_NAME)

    # send to slack
    def slack(text, fields=None):
        nonlocal SLACK_SNS_TOPIC
        nonlocal ENV_NAME
        if SLACK_SNS_TOPIC:
            msg = {
                'channel': SLACK_CHANNEL,
                'username': f'ASG Scaling {ENV_NAME}',
                'icon_emoji': SLACK_ICON,
                'text': text,
            }
            if fields:
                msg['attachments'] = [{'fields': fields}]
            sns_client.publish(
                TopicArn=SLACK_SNS_TOPIC,
                Message=json.dumps(msg),
            )

    # lookup cluster instances and remove disconnected agents
    all_usages = get_usages(ECS_CLUSTER)
    usages = list(filter(lambda u: u['disconnectseconds'] < DISCONNECT_THRESHOLD_SECONDS, all_usages))

    # return early if already scaling
    if len(usages) == 0:
        log_error(f'No instances running in cluster {ECS_CLUSTER}')
        return
    [reason, warn] = is_scaling(ASG_NAME, [u['id'] for u in usages], DRY_RUN)
    if reason:
        if warn:
            log_warn(f'Already scaling: {reason}')
        else:
            log_debug(f'Already scaling: {reason}')
        log_usages(all_usages)
        return

    # find max cpu/mem reservations in this cluster (SLOW)
    [MAX_CPU, MAX_MEM] = get_max_reservations(ECS_CLUSTER)
    target = f'Targeting {EMPTY_SLOTS}x [{MAX_CPU} cpu / {MAX_MEM} mem]'
    log_debug(target)
    log_usages(usages)

    # how many MAX-sized tasks can fit in this cluster
    num_slots = 0
    for usage in usages:
        cpu = usage['cpu']
        mem = usage['mem']
        while cpu >= MAX_CPU and mem >= MAX_MEM:
            num_slots += 1
            cpu -= MAX_CPU
            mem -= MAX_MEM

    # calculate how many MAX-sized tasks could fit on 1 instance
    total_cpu = usages[0]['tcpu']
    total_memory = usages[0]['tmem']
    per_instance = 0
    while total_cpu > 0 and total_memory > 0:
        per_instance += 1
        total_cpu -= MAX_CPU
        total_memory -= MAX_MEM
    state = f'{num_slots} slots available'
    capacity = f'{per_instance} per empty-instance'
    log_debug(f'{state} ({capacity})')

    # scale!
    delta = 0
    if num_slots < EMPTY_SLOTS:
        delta = 1
    elif (num_slots - EMPTY_SLOTS - per_instance) > 0:
        delta = -1
    asg = scale_asg(ASG_NAME, delta, DRY_RUN)

    # fancy slack attachment fields
    slack_fields = [
        {'title': 'Target', 'value': target, 'short': True},
        {'title': 'State', 'value': f'{state}\n{capacity}', 'short': True},
    ]

    # logging is important
    if asg['next'] < asg['prev']:
        msg = 'DRY RUN Scale IN - ' if DRY_RUN else 'Scale IN - '
        if asg['next'] < asg['min']:
            msg += f"prevented by min-size {asg['min']}"
            log_warn(msg)
            slack(msg, slack_fields)
        else:
            msg += f"capacity from {asg['prev']} to {asg['next']}"
            log_info(msg)
            slack(msg, slack_fields)
    elif asg['next'] > asg['prev']:
        msg = 'DRY RUN Scale OUT - ' if DRY_RUN else 'Scale OUT - '
        if asg['next'] > asg['max']:
            msg += f"prevented by max-size {asg['max']}"
            log_warn(msg)
            slack(msg, slack_fields)
        else:
            msg += f"capacity from {asg['prev']} to {asg['next']}"
            log_info(msg)
            slack(msg, slack_fields)
    else:
        log_debug(f"No change - capacity at {asg['next']}")


def log_debug(msg): print('[DEBUG] ' + msg)


def log_info(msg): print('[INFO] ' + msg)


def log_warn(msg): print('[WARN] ' + msg)


def log_error(msg):
    print('[ERROR] ' + msg)
    raise Exception(msg)


def log_usages(usages):
    for usage in usages:
        if usage['disconnected']:
            seconds = usage['disconnectseconds']
            log_debug(f"    {usage['id']} - [{usage['cpu']} / {usage['mem']}] - DISCONNECTED {seconds}")
        else:
            log_debug(f"    {usage['id']} - [{usage['cpu']} / {usage['mem']}]")


def get_env(name, default_val=None):
    if name in os.environ:
        return os.environ[name]
    elif default_val is None:
        log_error(f'Missing env {name}')
    else:
        return default_val


def get_env_name(asg_name):
    match = re.match(r'.*(test|development|staging|production).*', asg_name)
    return match.group(1).capitalize() if match else asg_name


def is_scaling(asg_name, ecs_ids, dry_run):
    groups = asg_client.describe_auto_scaling_groups(
        AutoScalingGroupNames=[asg_name])
    if len(groups['AutoScalingGroups']) != 1:
        log_error(f'Invalid asg name {asg_name}')
    group = groups['AutoScalingGroups'][0]
    for instance in group['Instances']:
        iid = instance['InstanceId']
        state = instance['LifecycleState']
        if state != 'InService' and state != 'Terminated':
            return [f'lifecycle state {state}', False]
        if iid not in ecs_ids:
            desc = ec2_client.describe_instances(InstanceIds=[iid])
            launch = desc['Reservations'][0]['Instances'][0]['LaunchTime']
            elapsed = datetime.datetime.now(datetime.timezone.utc) - launch
            if elapsed.total_seconds() > ECS_AGENT_WAIT:
                if not dry_run:
                    ec2_client.terminate_instances(InstanceIds=[iid])
                return [f'terminating {iid} with stale ECS agent', True]
            else:
                return ['waiting for ECS agent connection', False]
    if len(group['Instances']) != group['DesiredCapacity']:
        return ['waiting for ASG instance count', False]
    return [False, False]


def get_max_reservations(cluster_name):
    maxCpu = 0
    maxMemory = 0
    paginator = ecs_client.get_paginator('list_services')
    page_iterator = paginator.paginate(cluster=cluster_name,
                                       PaginationConfig={'PageSize': 10})
    for page in page_iterator:
        services = ecs_client.describe_services(cluster=cluster_name,
                                                services=page['serviceArns'])
        for service in services['services']:
            arn = service['taskDefinition']
            tdef = ecs_client.describe_task_definition(taskDefinition=arn)
            for container in tdef['taskDefinition']['containerDefinitions']:
                mem = container.get('memoryReservation', container['memory'])
                if container['cpu'] > maxCpu:
                    maxCpu = container['cpu']
                if mem > maxMemory:
                    maxMemory = mem
    return [maxCpu, maxMemory]


def get_usages(cluster_name):
    instance_list = ecs_client.list_container_instances(cluster=cluster_name)
    instance_arns = instance_list['containerInstanceArns']
    details = ecs_client.describe_container_instances(
        cluster=cluster_name, containerInstances=instance_arns)
    usages = list(map(get_usage, details['containerInstances']))

    # mark elapsed time agents have been disconnected
    cluster_arn = get_cluster_arn(cluster_name)
    disconnects = get_disconnects(cluster_arn)
    now = int(datetime.datetime.now().timestamp())
    for usage in usages:
        if usage['disconnected'] and disconnects.get(usage['id']):
            usage['disconnectseconds'] = now - disconnects.get(usage['id'])
    set_disconnects(cluster_arn, disconnects, usages, now)

    return usages


def get_usage(details):
    rem = details['remainingResources']
    reg = details['registeredResources']
    return {
        'id': details['ec2InstanceId'],
        'disconnected': details['agentConnected'] == False,
        'disconnectseconds': 0,
        'cpu': next(r['integerValue'] for r in rem if r['name'] == 'CPU'),
        'mem': next(r['integerValue'] for r in rem if r['name'] == 'MEMORY'),
        'tcpu': next(r['integerValue'] for r in reg if r['name'] == 'CPU'),
        'tmem': next(r['integerValue'] for r in reg if r['name'] == 'MEMORY'),
    }


def get_cluster_arn(cluster_name):
    clusters = ecs_client.describe_clusters(clusters=[cluster_name])
    return clusters['clusters'][0]['clusterArn']


def get_disconnects(cluster_arn):
    tags = ecs_client.list_tags_for_resource(resourceArn=cluster_arn)
    disconnects = {}
    for tag in tags['tags']:
        if tag['key'] == DISCONNECTS_TAG:
            for value in tag['value'].split(DISCONNECTS_DELIMITER):
                parts = value.split(DISCONNECTS_SEPARATOR)
                if len(parts) == 2:
                    disconnects[parts[0]] = int(parts[1])
    return disconnects


def set_disconnects(cluster_arn, previous_disconnects, usages, now):
    disconnects = []
    for usage in usages:
        if usage['disconnected']:
            disconnected_at = previous_disconnects.get(usage['id'], now)
            disconnects.append(f"{usage['id']}{DISCONNECTS_SEPARATOR}{disconnected_at}")
    val = DISCONNECTS_DELIMITER.join(disconnects)
    tags = [{'key': DISCONNECTS_TAG, 'value': val}]
    ecs_client.tag_resource(resourceArn=cluster_arn, tags=tags)


def scale_asg(asg_name, delta, dry_run):
    group = asg_client.describe_auto_scaling_groups(
        AutoScalingGroupNames=[asg_name])['AutoScalingGroups'][0]
    asg_data = {
        'min': group['MinSize'],
        'max': group['MaxSize'],
        'prev': group['DesiredCapacity'],
        'next': group['DesiredCapacity'] + delta,
    }
    is_ok = (asg_data['next'] >= asg_data['min'] and
             asg_data['next'] <= asg_data['max'])
    if is_ok and asg_data['next'] != asg_data['prev'] and not dry_run:
        asg_client.set_desired_capacity(AutoScalingGroupName=asg_name,
                                        DesiredCapacity=asg_data['next'],
                                        HonorCooldown=False)
    return asg_data
