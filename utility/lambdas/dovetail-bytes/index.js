/**
 * Console.log (to cloudwatch logs) the number of bytes of a file actually
 * sent by a cloudfront viewer-response event.
 */
exports.handler = (event, context, callback) => {
  const request = event.Records[0].cf.request
  const response = event.Records[0].cf.response
  try {
    const arn = (context || {}).invokedFunctionArn
    const region = (arn || '').replace(/^arn:aws:lambda:/, '').replace(/:.+$/, '')
    const method = request.method
    const status = parseInt(response.status, 10)
    const uuid = findRequestId(request.querystring)
    const digest = findDigest(request.uri)
    const length = findContentLength(response.headers)

    // validate request/response ranges
    const range = findRangeBytes(response.headers)
    const requestRange = findRequestRangeBytes(request.headers)

    // range must be valid, if present
    if (range !== false && requestRange !== false) {
      const total = findRangeTotal(range, length)
      const rangeStart = findRangeStart(range)
      const rangeEnd = findRangeEnd(range, rangeStart, length)
      if (method === 'GET' && status >= 200 && status < 300 && length > 0 && uuid) {
        const data = {uuid: uuid, start: rangeStart, end: rangeEnd, total: total, digest: digest, region: region}
        const json = JSON.stringify(data)
        console.info(json)
      }
    }
  } catch (err) {
    console.error(`[ERROR] ${err}`)
  }
  callback(null, response)
}
function findRequestId(str) {
  const param = (str || '').split('&').find(s => s.startsWith('reqid='))
  const id = (param || '').replace(/^reqid=/, '')
  if (id) {
    return id
  } else {
    console.warn(`[WARN] No reqid present: ${str}`)
    return null
  }
}
function findDigest(path) {
  const parts = (path || '').replace(/^\//, '').split('/')
  if (parts.length === 3) {
    return parts[1]
  } else {
    return null
  }
}
function findContentLength(headers) {
  if (headers && headers['content-length'] && headers['content-length'][0]) {
    return parseInt(headers['content-length'][0]['value'], 10) || 0
  } else {
    return 0
  }
}
function findRangeBytes(headers) {
  if (headers && headers['content-range'] && headers['content-range'][0]) {
    const val = headers['content-range'][0]['value'] || ''
    if (val.startsWith('bytes ')) {
      return val.replace(/^bytes /, '')
    } else {
      console.error(`[ERROR] Unrecognized content-range: ${val}`)
      return false
    }
  } else {
    return ''
  }
}
function findRequestRangeBytes(headers) {
  if (headers && headers['range'] && headers['range'][0]) {
    const val = headers['range'][0]['value'] || ''
    if (val.indexOf(',') > -1) {
      console.error(`[ERROR] Multipart range not supported: ${val}`)
      return false
    } else {
      return val
    }
  } else {
    return ''
  }
}
function findRangeTotal(range, length) {
  const bytes = range.replace(/^[0-9]+-[0-9]+\//, '')
  return parseInt(bytes, 10) || length
}
function findRangeStart(range) {
  const bytes = range.replace(/-.+$/, '')
  return parseInt(bytes, 10) || 0
}
function findRangeEnd(range, start, length) {
  const bytes = range.replace(/[0-9]+-/, '').replace(/\/.+$/, '')
  return parseInt(bytes, 10) || (start + length - 1)
}
