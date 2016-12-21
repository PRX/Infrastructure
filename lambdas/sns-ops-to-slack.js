'use strict';

exports.handler = (event, context, callback) => {
    console.info(process.env.SLACK_WEBHOOK_URL)
    callback();
};
