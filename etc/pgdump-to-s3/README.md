# PostgreSQL Dump to S3

## Quick Setup

From within this directory: 
```bash
git clone https://github.com/jameshy/pgdump-aws-lambda.git lambda-src/pgdump-aws-lambda
```

Then copy the `postgres-17.5/` folder into `lambda-src/pgdump-aws-lambda/bin/`

Deploy:
```bash
sam build && sam deploy --resolve-s3 --config-env=staging
```

## Building Custom PostgreSQL Binaries (Optional)

This repository includes pre-built PostgreSQL 17.5 binaries for x86_64 architecture. If you need to build different versions or architectures:

### Using Docker (Recommended)

```bash
# Build PostgreSQL 17.5 binaries for x86_64 (Lambda compatible)
docker run -it --rm --platform linux/amd64 -v $(pwd):/workspace amazonlinux:2023 bash

# Inside the container:
dnf install -y make automake gcc gcc-c++ readline-devel zlib-devel openssl-devel libicu-devel wget tar gzip bison flex perl perl-FindBin

# Build PostgreSQL
wget https://ftp.postgresql.org/pub/source/v17.5/postgresql-17.5.tar.gz
tar zxf postgresql-17.5.tar.gz
cd postgresql-17.5
./configure --with-ssl=openssl
make
make install DESTDIR=/workspace/postgres-build

# Copy binaries to project
mkdir -p /workspace/lambda-src/pgdump-aws-lambda/bin/postgres-17.5
cp /workspace/postgres-build/usr/local/pgsql/bin/pg_dump /workspace/lambda-src/pgdump-aws-lambda/bin/postgres-17.5/
cp /workspace/postgres-build/usr/local/pgsql/lib/libpq.so.5 /workspace/lambda-src/pgdump-aws-lambda/bin/postgres-17.5/
```

### Using EC2 (Alternative)

1. Launch an EC2 instance with Amazon Linux 2023 AMI (x86_64 architecture)
2. Connect via SSH and run the build commands from the original [pgdump-aws-lambda README](https://github.com/jameshy/pgdump-aws-lambda#bundling-a-new-pg_dump-binary)
3. Download the binaries using `scp`

**Note**: Ensure the build architecture matches your Lambda function architecture (x86_64 by default).

### Update template.yml

After building custom binaries, update your `template.yml` to reference the new PostgreSQL version.

In the `AuguryCron` target Input, add or update the `PGDUMP_PATH`:

```yaml
"PGDUMP_PATH": "bin/postgres-17.5"
```
