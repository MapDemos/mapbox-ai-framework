# Lambda Security Configuration Guide

## Overview
This document describes the security measures implemented in the Lambda handler and how to configure them properly.

## Environment Variables

### Required Variables

```bash
CLAUDE_API_KEY=your_claude_api_key_here
```

### Security Variables

```bash
# Comma-separated list of allowed origins for CSRF protection
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Optional: Set default AI provider
DEFAULT_AI_PROVIDER=claude
```

## CSRF Protection

The Lambda handler implements CSRF protection through:

1. **Origin Header Validation**
   - Validates that requests come from allowed origins
   - Configure via `ALLOWED_ORIGINS` environment variable
   - Requests from unauthorized origins receive 403 Forbidden

2. **Referer Header Validation**
   - Cross-checks referer with origin for consistency
   - Helps prevent cross-site request forgery

## Lambda Configuration

### Function URL Settings

Configure CORS in Lambda Function URL settings:

```
Allowed Origins: https://yourdomain.com
Allowed Methods: POST, OPTIONS
Allowed Headers: Content-Type, x-ai-provider
Max Age: 300
```

### Recommended Resource Limits

```
Memory: 512 MB
Timeout: 30 seconds
Ephemeral Storage: 512 MB
```

### Throttling Configuration

Set concurrency limits to prevent abuse:

```
Reserved concurrent executions: 10-50 (adjust based on usage)
```

## AWS WAF Integration (Recommended)

Add AWS WAF to your Lambda Function URL for advanced protection:

1. **Rate Limiting Rule**
   ```
   Rate limit: 100 requests per 5 minutes per IP
   ```

2. **Geographic Restrictions** (Optional)
   ```
   Allow: Japan, US, EU (adjust based on your users)
   ```

3. **SQL Injection Protection**
   ```
   Enable AWS Managed Rules - SQL Injection
   ```

4. **XSS Protection**
   ```
   Enable AWS Managed Rules - XSS
   ```

## CloudWatch Monitoring

Enable logging and set up alarms:

1. **Log Group**: `/aws/lambda/japan-daytrip-proxy`

2. **Metric Filters**:
   - Track blocked requests: `[Security] Request blocked`
   - Monitor error rates: `[Lambda] Error`
   - Track API failures: `API error`

3. **CloudWatch Alarms**:
   ```
   - High error rate: > 10 errors in 5 minutes
   - High blocked request rate: > 50 blocks in 5 minutes
   - Latency spike: P99 > 5 seconds
   ```

## Secrets Management

Instead of environment variables, use AWS Secrets Manager:

```javascript
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const client = new SecretsManagerClient({ region: "us-east-1" });

async function getSecret(secretName) {
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);
  return JSON.parse(response.SecretString);
}

// In handler:
const secrets = await getSecret("japan-daytrip/api-keys");
const apiKey = secrets.CLAUDE_API_KEY;
```

## API Gateway Alternative

For more advanced rate limiting, consider using API Gateway:

1. **Advantages**:
   - Built-in rate limiting per API key
   - Request/response transformation
   - Caching support
   - Better monitoring

2. **Setup**:
   ```
   API Gateway REST API → Lambda Integration
   Rate Limit: 1000 requests/second burst
   Quota: 100,000 requests/month per API key
   ```

## Security Checklist

- [ ] Set `ALLOWED_ORIGINS` environment variable
- [ ] Store API keys in AWS Secrets Manager
- [ ] Enable CloudWatch logging
- [ ] Set up CloudWatch alarms
- [ ] Configure Lambda throttling limits
- [ ] Add AWS WAF rules (if needed)
- [ ] Enable X-Ray tracing for debugging
- [ ] Review IAM permissions (least privilege)
- [ ] Set up VPC if accessing private resources
- [ ] Enable encryption at rest for environment variables
- [ ] Regularly rotate API keys
- [ ] Monitor CloudWatch logs for suspicious activity

## Testing Security

### Test Origin Validation

```bash
# Should succeed (if origin is allowed)
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/ \
  -H "Origin: https://yourdomain.com" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'

# Should fail with 403
curl -X POST https://your-lambda-url.lambda-url.us-east-1.on.aws/ \
  -H "Origin: https://malicious-site.com" \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Monitor Blocked Requests

```bash
# View CloudWatch logs
aws logs tail /aws/lambda/japan-daytrip-proxy --follow --filter-pattern "[Security]"
```

## Incident Response

If you detect abuse:

1. **Immediate**:
   - Update `ALLOWED_ORIGINS` to remove compromised domain
   - Rotate API keys in Secrets Manager
   - Enable AWS WAF if not already enabled

2. **Investigation**:
   - Review CloudWatch logs for attack patterns
   - Check API usage from Claude/Gemini dashboards
   - Identify affected time range

3. **Prevention**:
   - Add IP blocks to WAF
   - Reduce rate limits
   - Add additional validation rules
   - Consider adding API key authentication

## Support

For issues or questions:
- AWS Support: https://console.aws.amazon.com/support/
- Anthropic Support: https://support.anthropic.com/
