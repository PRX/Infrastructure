'use strict';

const url = require('url');
const https = require('https');
const querystring = require('querystring');

exports.handler = (event, context, callback) => {
    try {
        processEvent(event, context, callback);
    } catch (e) {
        callback(e);
    }
};

const processEvent = (event, context, callback) => {
    const body = querystring.parse(event.body);
    const payload = JSON.parse(body.payload);

    if (payload.token !== process.env.SLACK_VERIFICATION_TOKEN) {
        // Bad request; bogus token
        callback(null, { statusCode: 400, headers: {}, body: null });
    } else {
        const attachment = payload.original_message.attachments[0];
        delete attachment.actions;
        delete attachment.id;
        delete attachment.callback_id;


        let note = '';
        if (payload.actions[0].value === 'reject') {
            note = `This ChangeSet was *Rejected* by ${payload.user.name}`;
            attachment.color = '#BD0000';
        } else {
            note = `This ChangeSet was *Approved* ${payload.user.name}`;
            attachment.color = '#00B803';
        }

        const msg = {
            text: note,
            attachments: [attachment]
        };
        const responseBody = JSON.stringify(msg);
        callback(null, { statusCode: 200, headers: {}, body: responseBody });
    }
};
