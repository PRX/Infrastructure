# Invoked by: TBD
# Returns: Error or status message
#
#  Make an ASG the perfect size for an ECS cluster

import os
import boto3

session = boto3.session.Session()
asg_client = session.client(service_name='autoscaling')
ecs_client = session.client(service_name='ecs')


def lambda_handler(event, context):
    ASG_NAME = get_env('ASG_NAME')
    ECS_CLUSTER = get_env('ECS_CLUSTER')
    MAX_CPU = int(get_env('THRESHOLD_CPU'))
    MAX_MEM = int(get_env('THRESHOLD_MEMORY'))
    MAX_COUNT = int(get_env('THRESHOLD_COUNT'))
    DRY_RUN = True if 'DRY_RUN' in os.environ else False

    usages = get_usages(ECS_CLUSTER)
    log_debug(f'Targeting {MAX_COUNT}x [{MAX_CPU} cpu / {MAX_MEM} mem]')
    for usage in usages:
        log_debug(f"    {usage['id']} - {usage['cpu']} / {usage['mem']}")
    if len(usages) == 0:
        log_error(f'No instances running in cluster {ECS_CLUSTER}')

    # return early if already scaling
    reason = is_scaling(ASG_NAME, len(usages))
    if reason:
        log_debug(f'Already scaling: {reason}')
        return

    # how many THRESHOLD-sized tasks can fit in this cluster
    num_slots = 0
    for usage in usages:
        cpu = usage['cpu']
        mem = usage['mem']
        while cpu >= MAX_CPU and mem >= MAX_MEM:
            num_slots += 1
            cpu -= MAX_CPU
            mem -= MAX_MEM

    # calculate how many THRESHOLD-sized tasks could fit on 1 instance
    total_cpu = usages[0]['tcpu']
    total_memory = usages[0]['tmem']
    slots_per_instance = 0
    while total_cpu > 0 and total_memory > 0:
        slots_per_instance += 1
        total_cpu -= MAX_CPU
        total_memory -= MAX_MEM

    # scale!
    msg = f'{num_slots} slots available ({slots_per_instance}/instance)'
    if num_slots < MAX_COUNT:
        log_info('Scale UP: ' + msg)
        scale_asg(ASG_NAME, 1, DRY_RUN)
    elif (num_slots - MAX_COUNT - slots_per_instance) > 0:
        log_info('Scale DOWN: ' + msg)
        scale_asg(ASG_NAME, -1, DRY_RUN)
    else:
        log_debug('No Change: ' + msg)


def log_debug(msg): print('[DEBUG] ' + msg)


def log_info(msg): print('[INFO] ' + msg)


def log_warn(msg): print('[WARN] ' + msg)


def log_error(msg):
    print('[ERROR] ' + msg)
    raise Exception(msg)


def get_env(name):
    if name in os.environ:
        return os.environ[name]
    else:
        log_error(f'Missing env {name}')


def is_scaling(asg_name, ecs_cluster_count):
    groups = asg_client.describe_auto_scaling_groups(
        AutoScalingGroupNames=[asg_name])
    if len(groups['AutoScalingGroups']) != 1:
        log_error(f'Invalid asg name {asg_name}')
    group = groups['AutoScalingGroups'][0]
    for instance in group['Instances']:
        state = instance['LifecycleState']
        if state != 'InService' and state != 'Terminated':
            return f'lifecycle state {state}'
    if len(group['Instances']) != group['DesiredCapacity']:
        return 'waiting for ASG instance count'
    if len(group['Instances']) != ecs_cluster_count:
        return 'waiting for ECS agent connection'


def get_usages(clusterName):
    instance_list = ecs_client.list_container_instances(cluster=clusterName)
    instance_arns = instance_list['containerInstanceArns']
    details = ecs_client.describe_container_instances(
        cluster=clusterName, containerInstances=instance_arns)
    return list(map(get_usage, details['containerInstances']))


def get_usage(details):
    rem = details['remainingResources']
    reg = details['registeredResources']
    return {
        'id': details['ec2InstanceId'],
        'cpu': next(r['integerValue'] for r in rem if r['name'] == 'CPU'),
        'mem': next(r['integerValue'] for r in rem if r['name'] == 'MEMORY'),
        'tcpu': next(r['integerValue'] for r in reg if r['name'] == 'CPU'),
        'tmem': next(r['integerValue'] for r in reg if r['name'] == 'MEMORY'),
    }


def scale_asg(asg_name, delta, dry_run):
    group = asg_client.describe_auto_scaling_groups(
        AutoScalingGroupNames=[asg_name])['AutoScalingGroups'][0]
    desired = group['DesiredCapacity'] + delta
    if desired > group['MaxSize']:
        log_warn('Already at max-size')
    elif desired < group['MinSize']:
        log_warn('Already at min-size')
    elif dry_run:
        log_debug(f'DRY RUN desired capacity to {desired}')
    else:
        asg_client.set_desired_capacity(AutoScalingGroupName=asg_name,
                                        DesiredCapacity=desired,
                                        HonorCooldown=False)
        log_debug(f'Updated desired capacity to {desired}')
