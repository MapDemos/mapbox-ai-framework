#!/bin/bash

# Deploy Claude API proxy to AWS Lambda
# Uses Mapbox CLI for AWS authentication (same as deploy.sh)

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=====================================${NC}"
echo -e "${BLUE}Lambda Deployment - Claude API Proxy${NC}"
echo -e "${BLUE}=====================================${NC}"
echo ""

# Step 1: Setup Mapbox CLI environment
echo -e "${BLUE}Setting up Mapbox CLI environment...${NC}"

# Try to source mbxcli from common locations
MBXCLI_PATHS=(
    "/opt/homebrew/lib/node_modules/@mapbox/mbxcli/bin/mapbox.sh"
    "/usr/local/lib/node_modules/@mapbox/mbxcli/bin/mapbox.sh"
    "$(npm root -g 2>/dev/null)/@mapbox/mbxcli/bin/mapbox.sh"
)

MBXCLI_FOUND=false
for path in "${MBXCLI_PATHS[@]}"; do
    if [ -f "$path" ]; then
        source "$path"
        echo -e "${GREEN}✓ Mapbox CLI environment loaded from: $path${NC}"
        MBXCLI_FOUND=true
        break
    fi
done

if [ "$MBXCLI_FOUND" = false ]; then
    echo -e "${YELLOW}⚠ mbxcli not found in common locations${NC}"
    echo -e "${YELLOW}  Attempting to use AWS CLI directly...${NC}"
fi

# Step 2: Check if mbx command is available
if command -v mbx &> /dev/null; then
    echo -e "${BLUE}Authenticating with Mapbox...${NC}"

    # Run mbx env to set up AWS credentials
    if mbx env &> /dev/null; then
        echo -e "${GREEN}✓ Mapbox authentication successful${NC}"
    else
        echo -e "${YELLOW}⚠ mbx env failed, trying direct AWS access...${NC}"
    fi
else
    echo -e "${YELLOW}⚠ mbx command not found${NC}"
    echo -e "${YELLOW}  Install with: npm install -g @mapbox/mbxcli${NC}"
    echo -e "${YELLOW}  Falling back to standard AWS CLI...${NC}"
fi
echo ""

# Step 3: Check AWS credentials
echo -e "${BLUE}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity &> /dev/null; then
    echo -e "${RED}Error: AWS credentials not configured${NC}"
    echo ""
    echo "Try one of these:"
    echo "  1. mbx login               (Mapbox employees)"
    echo "  2. aws configure           (AWS access keys)"
    echo "  3. aws sso login           (AWS SSO)"
    exit 1
fi

CALLER_IDENTITY=$(aws sts get-caller-identity)
echo -e "${GREEN}✓ Authenticated as:${NC}"
echo "$CALLER_IDENTITY" | grep -E "(UserId|Account|Arn)"
echo ""

# Step 4: Check for Claude API key
if [ -z "$CLAUDE_API_KEY" ]; then
    echo -e "${RED}Error: CLAUDE_API_KEY environment variable not set${NC}"
    echo ""
    echo "Set it with:"
    echo "  export CLAUDE_API_KEY='sk-ant-...'"
    exit 1
fi
echo -e "${GREEN}✓ Claude API key found${NC}"
echo ""

echo -e "${BLUE}📦 Packaging Lambda function...${NC}"

# Create deployment package
cd lambda
zip -r function.zip handler.js package.json
cd ..

echo -e "${BLUE}🚀 Deploying to AWS Lambda...${NC}"

# Set your AWS region
AWS_REGION="us-east-1"
FUNCTION_NAME="mapbox-ai-proxy"

# Check if function exists
if aws lambda get-function --function-name $FUNCTION_NAME --region $AWS_REGION 2>/dev/null; then
  echo -e "${BLUE}Updating existing Lambda function...${NC}"
  aws lambda update-function-code \
    --function-name $FUNCTION_NAME \
    --zip-file fileb://lambda/function.zip \
    --region $AWS_REGION \
    > /dev/null
  echo -e "${GREEN}✓ Function code updated${NC}"
else
  echo -e "${BLUE}Creating new Lambda function...${NC}"

  # Create IAM role for Lambda (if it doesn't exist)
  ROLE_NAME="mapbox-ai-proxy-lambda-role"

  if ! aws iam get-role --role-name $ROLE_NAME 2>/dev/null; then
    echo -e "${BLUE}Creating IAM role...${NC}"
    aws iam create-role \
      --role-name $ROLE_NAME \
      --assume-role-policy-document '{
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Principal": {"Service": "lambda.amazonaws.com"},
          "Action": "sts:AssumeRole"
        }]
      }' \
      > /dev/null

    aws iam attach-role-policy \
      --role-name $ROLE_NAME \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

    echo -e "${GREEN}✓ IAM role created${NC}"
    echo -e "${BLUE}Waiting for role to be ready...${NC}"
    sleep 10
  fi

  ROLE_ARN=$(aws iam get-role --role-name $ROLE_NAME --query 'Role.Arn' --output text)

  aws lambda create-function \
    --function-name $FUNCTION_NAME \
    --runtime nodejs20.x \
    --role $ROLE_ARN \
    --handler handler.handler \
    --zip-file fileb://lambda/function.zip \
    --timeout 30 \
    --memory-size 256 \
    --region $AWS_REGION \
    > /dev/null

  echo -e "${GREEN}✓ Lambda function created${NC}"
fi

echo -e "${BLUE}⚙️  Setting environment variables...${NC}"

# Build environment variables JSON
ENV_VARS="{"
if [ -n "$CLAUDE_API_KEY" ]; then
  ENV_VARS="${ENV_VARS}CLAUDE_API_KEY=${CLAUDE_API_KEY}"
fi
if [ -n "$GEMINI_API_KEY" ]; then
  if [ "$ENV_VARS" != "{" ]; then
    ENV_VARS="${ENV_VARS},"
  fi
  ENV_VARS="${ENV_VARS}GEMINI_API_KEY=${GEMINI_API_KEY}"
fi
if [ -n "$DEFAULT_AI_PROVIDER" ]; then
  if [ "$ENV_VARS" != "{" ]; then
    ENV_VARS="${ENV_VARS},"
  fi
  ENV_VARS="${ENV_VARS}DEFAULT_AI_PROVIDER=${DEFAULT_AI_PROVIDER}"
else
  if [ "$ENV_VARS" != "{" ]; then
    ENV_VARS="${ENV_VARS},"
  fi
  ENV_VARS="${ENV_VARS}DEFAULT_AI_PROVIDER=claude"
fi
ENV_VARS="${ENV_VARS}}"

aws lambda update-function-configuration \
  --function-name $FUNCTION_NAME \
  --environment "Variables=${ENV_VARS}" \
  --region $AWS_REGION \
  > /dev/null

echo -e "${GREEN}✓ Environment variables set${NC}"
if [ -n "$CLAUDE_API_KEY" ]; then
  echo -e "  • CLAUDE_API_KEY configured"
fi
if [ -n "$GEMINI_API_KEY" ]; then
  echo -e "  • GEMINI_API_KEY configured"
fi
echo ""

echo -e "${GREEN}=====================================${NC}"
echo -e "${GREEN}✅ Lambda function deployed!${NC}"
echo -e "${GREEN}Function: ${FUNCTION_NAME}${NC}"
echo -e "${GREEN}=====================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo -e "${BLUE}Option 1: Create Function URL (simplest):${NC}"
echo "  aws lambda create-function-url-config \\"
echo "    --function-name $FUNCTION_NAME \\"
echo "    --auth-type NONE \\"
echo "    --cors 'AllowOrigins=[\"*\"],AllowMethods=[\"POST\",\"OPTIONS\"],AllowHeaders=[\"Content-Type\",\"X-AI-Provider\"]' \\"
echo "    --region $AWS_REGION"
echo ""
echo -e "${BLUE}Option 2: Create API Gateway:${NC}"
echo "  https://console.aws.amazon.com/apigateway"
echo "  1. Create HTTP API"
echo "  2. Add route: POST /api/ai → $FUNCTION_NAME"
echo "  3. Enable CORS"
echo ""
echo -e "${YELLOW}Then update config.js with the Function URL or API Gateway URL${NC}"
echo ""
