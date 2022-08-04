import os
import time
import boto3

def handler(event, context):
    s3 = boto3.client('s3')

    client = boto3.client('cloudfront')
    client.create_invalidation(
        DistributionId=os.environ['cfid'],
        InvalidationBatch={
            'Paths': {
                'Quantity': 1,
                'Items': [
                    '/*',
                ]
            },
            'CallerReference': str(time.time()).replace(".", "")
        }
    )
