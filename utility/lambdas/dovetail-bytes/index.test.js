const handler = require('./index').handler

describe('handler', () => {

  beforeEach(() => {
    jest.spyOn(global.console, 'info').mockImplementation(() => null)
    jest.spyOn(global.console, 'warn').mockImplementation(() => null)
    jest.spyOn(global.console, 'error').mockImplementation(() => null)
  })
  afterEach(() => {
    jest.resetAllMocks()
  })

  const exec = () => new Promise((resolve, reject) => {
    const event = {Records: [{cf: {request: REQUEST, response: RESPONSE}}]}
    const context = {invokedFunctionArn: 'arn:aws:lambda:us-my-region-1:what/ever12_34'}
    handler(event, context, (err, result) => err ? reject(err) : resolve(result))
  })
  const getMessage = (level, index) => console[level].mock.calls[index][0]
  const getJSON = (level, index) => JSON.parse(console[level].mock.calls[index][0])

  let REQUEST, RESPONSE
  beforeEach(() => {
    REQUEST = {method: 'GET', querystring: 'reqid=1234abcd', uri: '/the_program_id/the_digest/the_filename.mp3'}
    RESPONSE = {status: '200', headers: {'content-length': [{value: '987654321'}], 'content-range': [{value: 'bytes 99-999/987654321'}]}}
  })

  it('logs complete downloads', async () => {
    delete RESPONSE.headers['content-range']
    await exec()
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(getJSON('info', 0)).toMatchObject({
      uuid: '1234abcd',
      start: 0,
      end: 987654320,
      total: 987654321,
      digest: 'the_digest',
      region: 'us-my-region-1',
    })
  })

  it('logs partial downloads', async () => {
    await exec()
    expect(console.info).toHaveBeenCalledTimes(1)
    expect(getJSON('info', 0)).toMatchObject({
      uuid: '1234abcd',
      start: 99,
      end: 999,
      total: 987654321,
      digest: 'the_digest',
      region: 'us-my-region-1',
    })
  })

  it('only logs get requests', async () => {
    REQUEST.method = 'HEAD'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    REQUEST.method = 'anything'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    REQUEST.method = 'GET'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(1)
  })

  it('only logs 200 responses', async () => {
    RESPONSE.status = '416'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    RESPONSE.status = '500'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    RESPONSE.status = 206
    await exec()
    expect(console.info).toHaveBeenCalledTimes(1)
  })

  it('only logs downloaded bytes', async () => {
    delete RESPONSE.headers['content-range']
    RESPONSE.headers['content-length'][0].value = '0'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    delete RESPONSE.headers['content-length']
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
  })

  it('only logs reqid bytes', async () => {
    REQUEST.querystring = 'foo=bar&reqid='
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(getMessage('warn', 0)).toEqual('[WARN] No reqid present: foo=bar&reqid=')
    delete REQUEST.querystring
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    expect(console.warn).toHaveBeenCalledTimes(2)
    expect(getMessage('warn', 1)).toEqual('[WARN] No reqid present: undefined')
  })

  it('only logs valid content-range', async () => {
    RESPONSE.headers['content-range'][0].value = 'stuff 99-999'
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    expect(console.warn).toHaveBeenCalledTimes(0)
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(getMessage('error', 0)).toEqual('[ERROR] Unrecognized content-range: stuff 99-999')
  })

  it('complains a multipart range response, but logs all the bytes', async () => {
    REQUEST.headers = {range: [{value: 'bytes=0-10,20-30'}]}
    RESPONSE.headers['content-length'][0].value = '296'
    RESPONSE.headers['content-type'] = [{value: 'multipart/byteranges; boundary=CloudFront:ED763B67C14CAB99C599FC5279DAF6FD'}]
    delete RESPONSE.headers['content-range']
    await exec()
    expect(console.info).toHaveBeenCalledTimes(0)
    expect(console.warn).toHaveBeenCalledTimes(0)
    expect(console.error).toHaveBeenCalledTimes(1)
  })

})
