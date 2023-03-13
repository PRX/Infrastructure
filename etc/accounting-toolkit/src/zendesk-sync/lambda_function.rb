require "uri"
require "net/http"
require "json"
require "base64"
require "rest-client"

ACC_ASSIGNMENT_FIELD_ID = "1900008644024"

PRX_TRIGGER_CATEGORY_ID = "1260804467810"
PRX_ASSIGNMENT_FIELD_ID = "4416437434395"

accounting_zendesk_api_creds = "#{ENV["ACCOUNTING_ZENDESK_API_USERNAME"]}:#{ENV["ACCOUNTING_ZENDESK_API_TOKEN"]}"
ACC_ZENDESK_API_AUTH_HEADER = "Basic #{Base64.strict_encode64(accounting_zendesk_api_creds)}"

prx_zendesk_api_creds = "#{ENV["PRX_ZENDESK_API_USERNAME"]}:#{ENV["PRX_ZENDESK_API_TOKEN"]}"
PRX_ZENDESK_API_AUTH_HEADER = "Basic #{Base64.strict_encode64(prx_zendesk_api_creds)}"

def get_agents_and_admins
  res = RestClient::Request.execute(
    method: :get,
    url: "https://prx.zendesk.com/api/v2/users?role[]=agent&role[]=admin",
    headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
  )

  JSON.parse(res)["users"]
end

def get_groups
  res = RestClient::Request.execute(
    method: :get,
    url: "https://prx.zendesk.com/api/v2/groups",
    headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
  )

  JSON.parse(res)["groups"]
end

def get_triggers
  res = RestClient::Request.execute(
    method: :get,
    url: "https://prx.zendesk.com/api/v2/triggers?category_id=#{PRX_TRIGGER_CATEGORY_ID}",
    headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
  )

  JSON.parse(res)["triggers"]
end

def update_assignment_fields(groups, users)
  options = []

  options += groups.map { |group| {name: "Groups::#{group["name"]}", value: "prx_acct_group_#{group["id"]}"} }
  options += users.map { |user| {name: "Users::#{user["name"]}", value: "prx_acct_user_#{user["id"]}"} }

  field_ids = {"prxaccounting" => ACC_ASSIGNMENT_FIELD_ID, "prx" => PRX_ASSIGNMENT_FIELD_ID}

  field_ids.each do |instance_id, field_id|
    RestClient::Request.execute(
      method: :put,
      url: "https://#{instance_id}.zendesk.com/api/v2/ticket_fields/#{field_id}",
      payload: {
        ticket_field: {
          custom_field_options: options.sort_by { |a| a[:name] }
        }
      }.to_json,
      headers: {authorization: (instance_id == "prx") ? PRX_ZENDESK_API_AUTH_HEADER : ACC_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
    )
  end
end

def delete_triggers
  triggers = get_triggers
  trigger_ids = triggers.map { |trigger| trigger["id"] }

  trigger_ids.each do |id|
    puts "Deleting triggrer #{id}"
    RestClient::Request.execute(
      method: :delete,
      url: "https://prx.zendesk.com/api/v2/triggers/#{id}",
      headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
    )
  end

  # TODO This isn't working, 400 Bad Request
  # res = RestClient::Request.execute(
  #   method: :delete,
  #   url: "https://prx.zendesk.com/api/v2/triggers/destroy_many?ids=#{trigger_ids.join(',')}",
  #   headers: { authorization: PRX_ZENDESK_API_AUTH_HEADER, 'content-type': 'application/json' }
  # )
end

def create_group_triggers(groups)
  groups.filter { |g| ["360000792773", "20709744"].include?(g["id"].to_s) }.each do |group|
    puts "Creating trigger for group #{group["name"]}"
    RestClient::Request.execute(
      method: :post,
      url: "https://prx.zendesk.com/api/v2/triggers",
      payload: {
        trigger: {
          category_id: PRX_TRIGGER_CATEGORY_ID,
          title: "[Assign] #{group["name"]} (from Accounting shared ticket)",
          conditions: {
            all: [
              {
                field: "received_from",
                operator: "is",
                value: "1260801003550"
              }, {
                field: "custom_fields_#{PRX_ASSIGNMENT_FIELD_ID}",
                operator: "is",
                value: "prx_acct_group_#{group["id"]}"
              }, {
                field: "group_id",
                operator: "is",
                value: ""
              }, {
                field: "assignee_id",
                operator: "is",
                value: ""
              }
            ]
          },
          actions: [
            {
              field: "group_id",
              value: group["id"].to_s
            }
          ]
        }
      }.to_json,
      headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
    )
  end
end

def create_user_triggers(users)
  users.filter { |g| ["3319038", "5156018417"].include?(g["id"].to_s) }.each do |user|
    puts "Creating trigger for user #{user["name"]}"
    RestClient::Request.execute(
      method: :post,
      url: "https://prx.zendesk.com/api/v2/triggers",
      payload: {
        trigger: {
          category_id: PRX_TRIGGER_CATEGORY_ID,
          title: "[Assign] #{user["name"]} (from Accounting shared ticket)",
          conditions: {
            all: [
              {
                field: "received_from",
                operator: "is",
                value: "1260801003550"
              }, {
                field: "custom_fields_#{PRX_ASSIGNMENT_FIELD_ID}",
                operator: "is",
                value: "prx_acct_user_#{user["id"]}"
              }, {
                field: "group_id",
                operator: "is",
                value: ""
              }, {
                field: "assignee_id",
                operator: "is",
                value: ""
              }
            ]
          },
          actions: [
            {
              field: "assignee_id",
              value: user["id"].to_s
            }
          ]
        }
      }.to_json,
      headers: {authorization: PRX_ZENDESK_API_AUTH_HEADER, "content-type": "application/json"}
    )
  end
end

def lambda_handler(event:, context:)
  groups = get_groups
  users = get_agents_and_admins

  # update_assignment_fields(groups, users)

  delete_triggers
  create_group_triggers(groups)
  create_user_triggers(users)

  nil
end
