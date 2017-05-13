import boto3
import traceback
import json
import os

code_pipeline = boto3.client('codepipeline')
sns = boto3.client('sns')

def put_job_success(job, message):
    print('Putting job success')
    print(message)
    code_pipeline.put_job_success_result(jobId=job['id'])

def put_job_failure(job, message):
    print('Putting job failure')
    print(message)
    code_pipeline.put_job_failure_result(jobId=job['id'], failureDetails={'message': message, 'type': 'JobFailed'})

def lambda_handler(event, context):
    try:
        print('Posting notification...')

        job = event['CodePipeline.job']

        input_artifact = job['data']['inputArtifacts'][0]

        env = job['data']['actionConfiguration']['configuration']['UserParameters']

        topic_arn = os.environ['DEPLOY_NOTIFICATION_TOPIC_ARN']
        message = json.dumps({
            'environment': env,
            'commit': input_artifact['revision'],
            'region': os.environ['AWS_REGION']
        })

        sns.publish(TopicArn=topic_arn, Message=message)

        put_job_success(job, '')

        return '...Done'

    except Exception as e:
        print('Function failed due to exception.')
        print(e)
        traceback.print_exc()
        put_job_failure(job, 'Function exception: ' + str(e))
