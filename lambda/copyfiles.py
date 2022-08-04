import os
import boto3

def handler(event, context):
    s3 = boto3.client('s3')
    s3r = boto3.resource('s3')

    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=os.environ['readBucket'])

    for page in pages:
        for obj in page['Contents']:
            copy_source = {
                'Bucket': os.environ['readBucket'],
                'Key': obj['Key']
            }
            s3r.meta.client.copy(
                copy_source, os.environ['writeBucket'], obj['Key'])
