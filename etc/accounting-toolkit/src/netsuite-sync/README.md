See also:

- [REST API Browser](https://system.netsuite.com/help/helpcenter/en_US/APIs/REST_API_Browser/record/v1/2021.2/index.html)
- [SuiteTalk REST Web Services API Guide](https://9999999-sb1.app.netsuite.com/app/help/helpcenter.nl?fid=book_1559132836.html&whence=)
- [SuiteTalk REST Web Services Records Guide](https://9999999-sb1.app.netsuite.com/app/help/helpcenter.nl?fid=book_157830111504.html)

# Customizations

Add exclude booleans

**Customization > List, Records, & Fields > Other record fields > New**

(This is for native record types)

For each `Record Type` of `Department`, `Class` (may also be called `Program`), and `Expense Category`:

- Label: Exclude from Zendesk
- Type: Checkbox
- ID: `_class_zd_exclude`, or `_dept_zd_exclude`, or `_expensecat_zd_exclude`

`_class_zd_exclude` must be called `_class_zd_exclude`, even if the record is called `Program`

**Customization > List, Records, & Fields > Record Types**

(This is for record types used in custom segments)

For `Projects` and `Grants`:

`Fields` subtab > New Field

- Label: Exclude from Zendesk
- ID: `_grant_zd_exclude` or `_project_zd_exclude`
- Type: checkbox

# API Access

This will enable [OAuth 2.0 Client Credentials](https://9999999-sb1.app.netsuite.com/app/help/helpcenter.nl?fid=section_162686838198.html) access.

Requires the following SuiteCloud features:
- REST Web Services
- REST Record Service (Beta)
- OAuth 2.0

Permissions required for client credentials role (this should be a role that has no other permissions, and is used only for this integration):
- Setup > REST Web Services (Full) - needed to access the REST API
- Setup > Log in using OAuth 2.0 Access Tokens (Full) - needed to authenticate using a client credentials token
- Reports > SuiteAnalytics Workbook (Edit) - Needed, but unsure why
- Lists > Classes (View) - For accessing Programs records
- Lists > Departments (View) - For accessing Departments records
- Lists > Expense Categories (View) - For accessing Accounts/expense category records
- Custom Record > Grant (View) - For accessing Grants records
- Custom Record > Projects (View) - For accessing Projects records

### 1. Generate Key & Certificate

`openssl req -x509 -newkey rsa:4096 -sha256 -keyout auth-key.pem -out auth-cert.pem -nodes -days 730`

### 2. Create Integration Record

[See more](https://9999999-sb1.app.netsuite.com/app/help/helpcenter.nl?fid=section_157771733782.html)

**Setup > Integration > Integration Management > Manage Integrations > New**

- Uncheck all checkboxes
- Check OAuth 2.0 > CLIENT CREDENTIALS
- Check OAuth 2.0 > REST WEB SERVICES
- Give a name (like `Zendesk Sync`)
- Click Save
- Make a copy of the `Client ID` and `Client Secret` that are displayed on the resulting page

### 3. Creating a Mapping for the Client Credentials Flow

[See more](https://9999999-sb1.app.netsuite.com/app/help/helpcenter.nl?fid=section_162686838198.html)

**Setup > Integration > Manage Authentication > OAuth 2.0 Client Credentials (M2M) Setup**

- Create New
- Select an entity (user) that belongs to the client credentials role
- Select the client credentials role that was created specifically for this app
- Select the integration record from the previous step as the application
- Choose the `auth-cert.pem` file created in step 1.
- Save
- Make note of `Certificate ID` on the new record

## Possibly also useful

This generates a token, but I don't remember what it's used for. Maybe making manual requests locally, like in Postman

```ruby
require 'jwt'

cert = OpenSSL::X509::Certificate.new(File.new('./auth-cert.pem'))
rsa_private = OpenSSL::PKey.read(File.new('./auth-key.pem'))
rsa_public = rsa_private.public_key
fingerprint = OpenSSL::Digest::SHA1.new(cert.to_der).to_s
headers = {
  typ: 'JWT',
  kid: '____________' # Certificate ID from https://XXXXX-sb1.app.netsuite.com/app/oauth2/clientcredentials/setup.nl?whence=
}
now = Time.now
payload = {
  iss: '____________', # Client ID from Integration creation
  scope: 'rest_webservices',
  aud: 'https://XXXXX-sb1.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token',
  exp: now.to_i + 600,
  iat: now.to_i,
}
token = JWT.encode payload, rsa_private, 'RS256', headers
puts token
decoded_token = JWT.decode token, rsa_public, true, { algorithm: 'RS256' }

```
