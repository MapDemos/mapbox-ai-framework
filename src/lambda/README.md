# AWS Lambda Deployment for Claude API Proxy

This directory contains the AWS Lambda function that proxies Claude API requests to avoid CORS issues in the browser.

## Architecture

```
Browser (S3 Static Site)
    ↓ POST /api/claude
API Gateway (HTTPS endpoint)
    ↓
Lambda Function
    ↓ Forward with API key
Claude API (api.anthropic.com)
```

## Prerequisites

1. **AWS CLI** installed and configured:
   ```bash
   aws configure
   ```

2. **AWS Account** with permissions for:
   - Lambda
   - API Gateway
   - IAM (to create execution role)

3. **Claude API Key** as environment variable:
   ```bash
   export CLAUDE_API_KEY="sk-ant-..."
   ```

## Deployment Options

### Option 1: Automated Script (Recommended)

```bash
# Make script executable
chmod +x lambda/deploy-lambda.sh

# Set your Claude API key
export CLAUDE_API_KEY="sk-ant-..."

# Deploy
./lambda/deploy-lambda.sh
```

### Option 2: AWS Console (Manual)

#### Step 1: Create Lambda Function

1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda)
2. Click **Create function**
3. Choose **Author from scratch**
4. Settings:
   - Function name: `mapbox-ai-proxy`
   - Runtime: **Node.js 20.x**
   - Architecture: **x86_64**
5. Click **Create function**

#### Step 2: Upload Code

1. In the Lambda function page, click **Upload from** → **.zip file**
2. Create deployment package:
   ```bash
   cd lambda
   zip -r function.zip handler.js package.json
   ```
3. Upload `function.zip`

#### Step 3: Configure Environment Variables

1. Go to **Configuration** → **Environment variables**
2. Click **Edit** → **Add environment variable**
3. Key: `CLAUDE_API_KEY`
4. Value: Your Claude API key (`sk-ant-...`)
5. Click **Save**

#### Step 4: Adjust Settings

1. Go to **Configuration** → **General configuration** → **Edit**
2. Set **Timeout**: 30 seconds
3. Set **Memory**: 256 MB
4. Click **Save**

#### Step 5: Create API Gateway

1. In Lambda function page, click **Add trigger**
2. Select **API Gateway**
3. Settings:
   - API type: **HTTP API**
   - Security: **Open**
   - CORS: **Enable**
4. Click **Add**

#### Step 6: Get API Endpoint

1. Go to **Configuration** → **Triggers**
2. Copy the **API endpoint** URL (looks like: `https://abc123.execute-api.us-east-1.amazonaws.com/default/mapbox-ai-proxy`)

#### Step 7: Update Frontend Config

Edit `config.js`:
```javascript
CLAUDE_API_PROXY: 'https://YOUR-API-ID.execute-api.us-east-1.amazonaws.com/default/mapbox-ai-proxy'
```

### Option 3: AWS SAM (Infrastructure as Code)

Create `template.yaml`:
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  ClaudeProxyFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: mapbox-ai-proxy
      Handler: handler.handler
      Runtime: nodejs20.x
      Timeout: 30
      MemorySize: 256
      Environment:
        Variables:
          CLAUDE_API_KEY: !Ref ClaudeApiKey
      Events:
        ApiEvent:
          Type: HttpApi
          Properties:
            Path: /api/claude
            Method: POST
            ApiId: !Ref HttpApi

  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      CorsConfiguration:
        AllowOrigins:
          - "*"
        AllowMethods:
          - POST
          - OPTIONS
        AllowHeaders:
          - Content-Type

Parameters:
  ClaudeApiKey:
    Type: String
    NoEcho: true
    Description: Claude API Key

Outputs:
  ApiUrl:
    Description: API Gateway endpoint URL
    Value: !Sub 'https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com/api/claude'
```

Deploy:
```bash
sam build
sam deploy --guided --parameter-overrides ClaudeApiKey=$CLAUDE_API_KEY
```

## Testing

Test the Lambda function:

```bash
curl -X POST https://YOUR-API-URL/api/claude \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Cost Estimate

**AWS Lambda:**
- Free tier: 1M requests/month + 400,000 GB-seconds
- After free tier: $0.20 per 1M requests
- Memory: $0.0000166667 per GB-second

**API Gateway:**
- Free tier: 1M requests/month (12 months)
- After free tier: $1.00 per 1M requests

**Example usage:** 10,000 requests/month = **FREE** (within free tier)

## Monitoring

View Lambda logs:
```bash
aws logs tail /aws/lambda/mapbox-ai-proxy --follow
```

Or in AWS Console:
1. Go to Lambda function
2. Click **Monitor** → **View CloudWatch logs**

## Troubleshooting

### CORS errors
- Ensure API Gateway CORS is enabled
- Check that Lambda returns proper CORS headers

### 401 Unauthorized from Claude API
- Verify `CLAUDE_API_KEY` environment variable is set correctly
- Check CloudWatch logs for error details

### Timeout errors
- Increase Lambda timeout (max 15 minutes)
- Check Claude API response times in CloudWatch

### Cold start issues
- Consider using Lambda provisioned concurrency
- Or accept 1-2 second cold start delay for first request

## Security Considerations

1. **API Key Protection**: API key is stored securely in Lambda environment variables
2. **CORS**: Currently set to `*` (all origins). For production, restrict to your domain:
   ```javascript
   'Access-Control-Allow-Origin': 'https://demos.mapbox.com'
   ```
3. **Rate Limiting**: Consider adding API Gateway rate limiting
4. **Authentication**: Add API Gateway authentication if needed

## Cleanup

To delete all resources:

```bash
# Delete Lambda function
aws lambda delete-function \
  --function-name mapbox-ai-proxy \
  --region us-east-1

# Delete API Gateway (get API ID first)
aws apigatewayv2 get-apis --query 'Items[?Name==`mapbox-ai-proxy`].ApiId' --output text
aws apigatewayv2 delete-api --api-id YOUR-API-ID

# Delete IAM role
aws iam detach-role-policy \
  --role-name your-project-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam delete-role --role-name your-project-lambda-role
```
