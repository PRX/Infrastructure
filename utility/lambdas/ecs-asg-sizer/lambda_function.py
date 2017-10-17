import boto3
import json
import os

session = boto3.session.Session()
asgClient = session.client(service_name='autoscaling')
ecsClient = session.client(service_name='ecs')

#
# Make an ASG the perfect size for an ECS cluster
#
def lambda_handler(event, context):
    asgName = get_env('ASG_NAME')
    clusterName = get_env('ECS_CLUSTER')
    thresholdCpu = int(get_env('THRESHOLD_CPU'))
    thresholdMemory = int(get_env('THRESHOLD_MEMORY'))
    thresholdCount = int(get_env('THRESHOLD_COUNT'))
    dryRun = True if 'DRY_RUN' in os.environ else False

    usages = get_usages(clusterName)
    log_debug('Targeting threshold {0}x {1} cpu / {2} mem'.format(thresholdCount, thresholdCpu, thresholdMemory))
    for usage in usages:
        log_debug('    {0} - {1} / {2}'.format(usage['id'], usage['remainingCpu'], usage['remainingMemory']))
    if len(usages) == 0:
        log_error('No instances running in cluster {0}'.format())

    # return early if already scaling
    reason = is_scaling(asgName, len(usages))
    if reason: log_debug('Already scaling: {0}'.format(reason)); return

    # how many THRESHOLD-sized tasks can fit in this cluster
    slotsAvailable = 0
    for usage in usages:
        cpu = usage['remainingCpu']
        mem = usage['remainingMemory']
        while cpu >= thresholdCpu and mem >= thresholdMemory:
            slotsAvailable += 1
            cpu -= thresholdCpu
            mem -= thresholdMemory

    # calculate how many THRESHOLD-sized tasks could fit on 1 instance
    totalCpu = usages[0]['totalCpu']
    totalMemory = usages[0]['totalMemory']
    slotsPerInstance = 0
    while totalCpu > 0 and totalMemory > 0:
        slotsPerInstance += 1
        totalCpu -= thresholdCpu
        totalMemory -= thresholdMemory

    # scale!
    msg = '{0} slots available ({1}/instance)'.format(slotsAvailable, slotsPerInstance)
    if slotsAvailable < thresholdCount:
        log_info('Scale UP: ' + msg)
        scale_asg(asgName, 1, dryRun)
    elif (slotsAvailable - thresholdCount - slotsPerInstance) > 0:
        log_info('Scale DOWN: ' + msg)
        scale_asg(asgName, -1, dryRun)
    else:
        log_debug('No Change: ' + msg)

# logging functions
def log_debug(msg): print('[DEBUG] ' + msg)
def log_info(msg): print('[INFO] ' + msg)
def log_warn(msg): print('[WARN] ' + msg)
def log_error(msg): print('[ERROR] ' + msg); raise Exception(msg)

# get env or raise
def get_env(name):
    if name in os.environ:
        return os.environ[name]
    else:
        log_error('Missing env {0}'.format(name))

# check asg for in-progress changes
def is_scaling(asgName, ecsClusterCount):
    groups = asgClient.describe_auto_scaling_groups(AutoScalingGroupNames=[asgName])
    if len(groups['AutoScalingGroups']) != 1:
        log_error('Invalid asg name {0}'.format(asgName))
    group = groups['AutoScalingGroups'][0]
    for instance in group['Instances']:
        state = instance['LifecycleState']
        if state != 'InService' and state != 'Terminated':
            return 'lifecycle state {0}'.format(state)
    if len(group['Instances']) != group['DesiredCapacity']:
        return 'waiting for ASG instance count'
    if len(group['Instances']) != ecsClusterCount:
        return 'waiting for ECS agent connection'

# get an array of usages from ECS
def get_usages(clusterName):
    instanceList = ecsClient.list_container_instances(cluster=clusterName)
    instanceArns = instanceList['containerInstanceArns']
    details = ecsClient.describe_container_instances(cluster=clusterName, containerInstances=instanceArns)
    return list(map(get_usage, details['containerInstances']))

# format ECS instance usage info
def get_usage(details):
    return {
        'id': details['ec2InstanceId'],
        'remainingCpu': next(res['integerValue'] for res in details['remainingResources'] if res['name'] == 'CPU'),
        'remainingMemory': next(res['integerValue'] for res in details['remainingResources'] if res['name'] == 'MEMORY'),
        'totalCpu': next(res['integerValue'] for res in details['registeredResources'] if res['name'] == 'CPU'),
        'totalMemory': next(res['integerValue'] for res in details['registeredResources'] if res['name'] == 'MEMORY'),
    }

# update the ASG desired count
def scale_asg(asgName, delta, dryRun):
    group = asgClient.describe_auto_scaling_groups(AutoScalingGroupNames=[asgName])['AutoScalingGroups'][0]
    desired = group['DesiredCapacity'] + delta
    if desired > group['MaxSize']:
        log_warn('Already at max-size')
    elif desired < group['MinSize']:
        log_warn('Already at min-size')
    elif dryRun:
        log_debug('DRY RUN desired capacity to {0}'.format(desired))
    else:
        asgClient.set_desired_capacity(AutoScalingGroupName=asgName, DesiredCapacity=desired, HonorCooldown=False)
        log_debug('Updated desired capacity to {0}'.format(desired))
