require "jwt"
require "uri"
require "net/http"
require "json"
require "base64"
require "rest-client"

accounting_zendesk_api_creds = "#{ENV["ACCOUNTING_ZENDESK_API_USERNAME"]}:#{ENV["ACCOUNTING_ZENDESK_API_TOKEN"]}"
ACC_ZENDESK_API_AUTH_HEADER = "Basic #{Base64.strict_encode64(accounting_zendesk_api_creds)}"

prx_zendesk_api_creds = "#{ENV["PRX_ZENDESK_API_USERNAME"]}:#{ENV["PRX_ZENDESK_API_TOKEN"]}"
PRX_ZENDESK_API_AUTH_HEADER = "Basic #{Base64.strict_encode64(prx_zendesk_api_creds)}"

def netsuite_access_token
  # cert = OpenSSL::X509::Certificate.new(File.new("./auth-cert.pem"))
  rsa_private = OpenSSL::PKey.read(File.new("./auth-key.pem"))

  now = Time.now
  headers = {
    typ: "JWT",
    kid: ENV["NETSUITE_CERTIFICATE_ID"] # Certificate ID from Setup > Integration > OAuth 2.0 Client Credentials Setup
  }
  payload = {
    iss: ENV["NETSUITE_CLIENT_ID"], # Client ID from Integration creation
    scope: "rest_webservices",
    aud: "https://#{ENV["NETSUITE_DOMAIN_SLUG"]}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token",
    exp: now.to_i + 600,
    iat: now.to_i
  }

  token = JWT.encode payload, rsa_private, "RS256", headers

  access_token_request_url = URI("https://#{ENV["NETSUITE_DOMAIN_SLUG"]}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token")
  access_token_request_res = Net::HTTP.post_form(access_token_request_url, "grant_type" => "client_credentials", "client_assertion_type" => "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", "client_assertion" => token)

  access_token_data = JSON.parse(access_token_request_res.body)
  access_token_data["access_token"]
end

AUTH_HEADER = "Bearer #{netsuite_access_token}"

def netsuite_records(type)
  puts "Getting [#{type}] records"

  record_list_res = RestClient::Request.execute(
    method: :get,
    url: "https://#{ENV["NETSUITE_DOMAIN_SLUG"]}.suitetalk.api.netsuite.com/services/rest/record/v1/#{type}",
    headers: {authorization: AUTH_HEADER}
  )
  record_list = JSON.parse(record_list_res.body)

  record_list["items"].map do |i|
    record_res = RestClient::Request.execute(
      method: :get,
      url: i["links"][0]["href"],
      headers: {authorization: AUTH_HEADER}
    )

    JSON.parse(record_res.body)
  end
end

def update_zendesk_field(field_ids, records)
  options = yield(records)

  field_ids.each do |instance_id, field_id|
    puts "Updating field:#{field_id} with #{options.length} options from #{records.length} records"

    RestClient::Request.execute(
      method: :put,
      url: "https://#{instance_id}.zendesk.com/api/v2/ticket_fields/#{field_id}",
      payload: {
        ticket_field: {
          custom_field_options: options
        }
      }.to_json,
      headers: {authorization: (instance_id == "prx") ? PRX_ZENDESK_API_AUTH_HEADER : ACC_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
    )
  end
end

def nested_name(record, records, separator = "::")
  if record["parent"]
    parent_id = record["parent"]["id"]
    parent_record = records.find { |r| r["id"] == parent_id }
    prefix = nested_name(parent_record, records)
  end

  [prefix, record["name"]].compact.join(separator)
end

def lambda_handler(event:, context:)
  department_field_id = {"prxaccounting" => "4415870641435", "prx" => "4416438481179"}
  update_zendesk_field(department_field_id, netsuite_records("department")) do |records|
    records
      .filter { |r| !r["isInactive"] }
      .filter { |r| !r["custrecord_dept_zd_exclude"] }
      .filter { |r| r["parent"] }
      .map { |r| {name: nested_name(r, records, " \u2013 "), value: "prx_netsuite_department_#{r["id"]}"} }
  end

  program_field_id = {"prxaccounting" => "4415963526555", "prx" => "4416459836699"}
  update_zendesk_field(program_field_id, netsuite_records("classification")) do |records|
    records
      .filter { |r| !r["isInactive"] }
      .filter { |r| !r["custrecord_class_zd_exclude"] }
      .map { |r| {name: nested_name(r, records), value: "prx_netsuite_program_#{r["id"]}"} }
      .sort_by { |a| a[:name] }
  end

  account_field_id = {"prxaccounting" => "4415976781083", "prx" => "4416438526235"}
  update_zendesk_field(account_field_id, netsuite_records("expenseCategory")) do |records|
    records
      .filter { |r| !r["isInactive"] }
      .filter { |r| !r["custrecord_expensecat_zd_exclude"] }
      .map { |r| {name: nested_name(r, records), value: "prx_netsuite_expcat_#{r["id"]}"} }
  end

  grant_field_id = {"prxaccounting" => "4415968778523", "prx" => "4416438495643"}
  update_zendesk_field(grant_field_id, netsuite_records("customrecord_cseg_npo_grant_segm")) do |records|
    records
      .filter { |r| !r["isInactive"] }
      .filter { |r| !r["custrecord_grant_zd_exclude"] }
      .map { |r| {name: nested_name(r, records), value: "prx_netsuite_grant_#{r["id"]}"} }
      .sort_by { |a| a[:name] }
  end

  project_field_id = {"prxaccounting" => "4415963355803", "prx" => "4416445822619"}
  update_zendesk_field(project_field_id, netsuite_records("customrecord_cseg_npo_fund_p")) do |records|
    records
      .filter { |r| !r["isInactive"] }
      .filter { |r| !r["custrecord_project_zd_exclude"] }
      .map { |r| {name: nested_name(r, records), value: "prx_netsuite_project_#{r["id"]}"} }
      .sort_by { |a| a[:name] }
  end
end
