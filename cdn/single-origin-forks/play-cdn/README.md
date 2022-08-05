Add the `DistributionConfig.CacheBehaviors` with a single behavior. The behavior is identical to the default behavior, except for:

```yaml
MaxTTL: 31536000 # 365 days
MinTTL: 7776000 # 90 days
PathPattern: /_next/image
```
