// filepath: [zoom.js](http://_vscodecontentref_/2)
const axios = require('axios');

async function getServerToServerAccessToken() {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const accountId = process.env.ZOOM_ACCOUNT_ID;

  const token = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    'https://zoom.us/oauth/token',
    null,
    {
      params: {
        grant_type: 'account_credentials',
        account_id: accountId,
      },
      headers: {
        Authorization: `Basic ${token}`,
      },
    }
  );
  return response.data.access_token;
}

async function createZoomMeeting(topic, startTime) {
  const accessToken = await getServerToServerAccessToken();
  const response = await axios.post(
    'https://api.zoom.us/v2/users/me/meetings',
    {
      topic: topic,
      type: 2,
      start_time: startTime,
      duration: 60,
      settings: {
        join_before_host: true,
        host_video: true,
        participant_video: true,
      }
    },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

module.exports = { createZoomMeeting };