#!/usr/bin/env ruby
# https://gist.github.com/cavis/ca2788d603bdce54e38771b9a7518971
require "bundler/inline"

gemfile do
  source "https://rubygems.org"

  gem "awesome_print"
  gem "aws-sdk-s3"
  gem "aws-sdk-lambda"
  gem "nokogiri"
  gem "pry"
end

s3 = Aws::S3::Client.new
lambda = Aws::Lambda::Client.new

def usage!
  cmd = "cdn-log-reprocess".green
  puts "Usage: #{cmd} --staging|production --start-date=2023-10-01 --end-date=2023-10-25"
  exit 1
end

if ARGV.delete("--staging")
  BUCKET = "prx-dovetail"
  PREFIX = "cdn-dovetail-staging-logs"
  LAMBDA = "cdn-log-shipper-staging-ShipperFunction-YfKRlcVDqKP8"
elsif ARGV.delete("--production")
  BUCKET = "prx-dovetail"
  PREFIX = "cdn-dovetail-production-logs"
  LAMBDA = "cdn-log-shipper-production-ShipperFunction-mKZQg2TodUam"
else
  usage!
end

limit = ARGV.find { |s| s.include?("--limit") }&.split("=")&.last.to_i
LIMIT = (limit > 0) ? limit : 100
LOG_FILE = "#{__dir__}/cdn-reprocess.log"
START_DATE = ARGV.find { |s| s.include?("--start-date") }&.split("=")&.last
END_DATE = ARGV.find { |s| s.include?("--end-date") }&.split("=")&.last
unless [START_DATE, END_DATE].all? { |d| d&.match(/[0-9]{4}-[0-9]{2}-[0-9]{2}/) }
  usage!
end

puts "processing logs for #{START_DATE.green} to #{END_DATE.green}"
puts "scanning s3://#{BUCKET}/#{PREFIX}/..."

keys = []
skip = 0
invalid = 0
res = nil
while res.nil? || res.next_continuation_token
  res = s3.list_objects_v2(bucket: BUCKET, prefix: PREFIX, continuation_token: res&.next_continuation_token)
  res.contents.each do |c|
    file_name = c.key.split("/").last
    if file_name.count(".") == 3
      date_str = file_name.split(".")[1][0...-3]
      if date_str >= START_DATE && date_str <= END_DATE
        keys << c.key
      else
        skip += 1
      end
    else
      invalid += 1
      puts "  INVALID key #{c.key}".red
    end
  end
end

already_processed = 0
if File.exist?(LOG_FILE)
  File.read(LOG_FILE).split("\n").each do |line|
    if keys.delete(line.strip)
      already_processed += 1
    end
  end
end

puts "  found #{keys.count.to_s.green} logs to process"
puts "  skipping #{already_processed.to_s.blue} already processed logs" if already_processed > 0
puts "  skipping #{skip.to_s.blue} logs for different days" if skip > 0
puts "  skipping #{invalid.to_s.red} files that didn't look like logs" if invalid > 0

keys.sort! do |a, b|
  a.split("/").last.split(".")[1] <=> b.split("/").last.split(".")[1]
end

puts "invoking lambda for files..."
processed = 0
threads = 10.times.map do
  Thread.new do
    while processed < LIMIT && (key = keys.shift)
      processed += 1
      event = JSON.generate(Records: [{s3: {bucket: {name: BUCKET}, object: {key: key}}}])
      res = lambda.invoke(function_name: LAMBDA, log_type: "Tail", payload: event)
      log = Base64.decode64(res.log_result)
      if (m = log.match(/Shipped ([0-9]+ of [0-9]+) ?/))
        puts "  #{key.split("/").last} (#{m[1].gray})"
        File.write(LOG_FILE, "#{key}\n", mode: "a+")
      else
        puts "  ERROR #{key} - bad response".red
      end
    end
  end
end

threads.map(&:join)

puts "finished #{processed.to_s.blue} files (#{keys.count.to_s.red} remaining)"
