'use strict';

const Homey = require('homey');
const axios = require('axios');
const mqtt = require('mqtt');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const API_BASE = 'https://api-eu-iot.lepro.com';
const APP_VERSION = '1.0.9.263';

function commonHeaders(token) {
  return {
    'App-Name': 'Lepro',
    'App-Version': APP_VERSION,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
    'Device-System': '16',
    GMT: '+0',
    Platform: '2',
    'Screen-Size': '1280*2856',
    Timestamp: `${Math.floor(Date.now() / 1000)}`,
    SLanguage: 'en',
    Language: 'en',
    'user-agent': `LE/${APP_VERSION} (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

module.exports = class LeproApp extends Homey.App {

  async onInit() {
    this.log('Lepro app initializing');

    /** @type {mqtt.MqttClient|null} */
    this.mqttClient = null;
    this.mqttConnected = false;
    this.secret = null; // account-scoped secret from /login, used for act/app/* topics
    this.uid = null;

    // Simple pub/sub so device.js instances can listen for status without
    // each opening their own MQTT connection.
    this.events = new EventEmitter();
    this.events.setMaxListeners(100);

    const token = this.homey.settings.get('token');
    if (token) {
      try {
        await this.connectMqtt();
      } catch (err) {
        this.error('Initial MQTT connect failed:', err.message);
      }
    } else {
      this.log('No stored token yet — waiting for pairing login.');
    }
  }

  // ---------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------

  /**
   * Logs in with email/password, stores token + secret, and opens MQTT.
   * Called from the driver's pairing flow.
   */
  async login(username, password) {
    const res = await axios.post(
      `${API_BASE}/user/login`,
      new URLSearchParams({ username, password }).toString(),
      { headers: commonHeaders(null) },
    );

    if (res.data.code !== 0) {
      throw new Error(res.data.msg || 'Login failed');
    }

    const { token, secret, uid } = res.data.data;
    this.homey.settings.set('token', token);
    this.homey.settings.set('secret', secret);
    this.homey.settings.set('uid', String(uid));

    this.secret = secret;
    this.uid = String(uid);

    await this.connectMqtt();
    return res.data.data;
  }

  getToken() {
    return this.homey.settings.get('token');
  }

  // ---------------------------------------------------------------------
  // MQTT lifecycle
  // ---------------------------------------------------------------------

  async connectMqtt() {
    const token = this.getToken();
    if (!token) throw new Error('No auth token — login first');

    this.secret = this.secret || this.homey.settings.get('secret');
    this.uid = this.uid || this.homey.settings.get('uid');

    // 1. Profile → mqtt host/port/cert URL/root CA URL
    const profileRes = await axios.get(`${API_BASE}/user/profile`, {
      headers: commonHeaders(token),
    });
    if (profileRes.data.code !== 0) {
      throw new Error(profileRes.data.msg || 'Failed to fetch profile');
    }
    const mqttData = profileRes.data.data.mqtt;

    // 2. Fetch + cache the root CA (rarely changes, but keep it fresh once)
    const rootCaPath = path.join(this.homey.app.getDataPath ? this.homey.app.getDataPath() : __dirname, 'AmazonRootCA13.pem');
    let rootCa;
    if (fs.existsSync(rootCaPath)) {
      rootCa = fs.readFileSync(rootCaPath);
    } else {
      const rootRes = await axios.get(mqttData.root, { headers: commonHeaders(token), responseType: 'text' });
      rootCa = Buffer.from(rootRes.data, 'utf8');
      fs.writeFileSync(rootCaPath, rootCa);
    }

    // 3. Fetch the per-account client cert (this one's URL is signed/scoped —
    //    re-fetch every connect rather than caching indefinitely).
    const certRes = await axios.get(mqttData.cert, {
      headers: commonHeaders(token),
      responseType: 'text',
    });
    const clientCert = certRes.data;

    // 4. Static shared client private key, bundled with the app.
    const privateKey = fs.readFileSync(path.join(__dirname, 'lepro_key.pem'));

    const clientId = `lepro-app-${this.uid}`;

    this.log('Connecting to Lepro MQTT broker:', mqttData.host, 'as', clientId);

    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (e) { /* ignore */ }
    }

    this.mqttClient = mqtt.connect({
      host: mqttData.host,
      port: parseInt(mqttData.port, 10),
      protocol: 'mqtts',
      clientId,
      ca: rootCa,
      cert: clientCert,
      key: privateKey,
      rejectUnauthorized: true,
      reconnectPeriod: 5000,
      clean: true,
    });

    this.mqttClient.on('connect', () => {
      this.mqttConnected = true;
      this.log('MQTT connected');
      this.events.emit('mqtt:connect');

      // Account-scoped execute channel (secret-based), per Topic.Sub.TOPIC_EXECUTE
      if (this.secret) {
        this.mqttClient.subscribe(`le/${this.secret}/act/app/exe`, { qos: 0 });
      }
    });

    this.mqttClient.on('reconnect', () => this.log('MQTT reconnecting...'));

    this.mqttClient.on('close', () => {
      this.mqttConnected = false;
      this.log('MQTT connection closed');
    });

    this.mqttClient.on('error', (err) => {
      this.error('MQTT error:', err.message);
    });

    this.mqttClient.on('message', (topic, payload) => {
      this._handleMessage(topic, payload);
    });

    return this.mqttClient;
  }

  _handleMessage(topic, payloadBuf) {
    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch (e) {
      this.log('Non-JSON MQTT message on', topic, payloadBuf.toString('utf8'));
      return;
    }

    this.log('MQTT message on', topic, payload);

    // Topics look like: le/{deviceId}/prp/rpt, le/{deviceId}/prp/setr, le/{deviceId}/prp/getr
    const parts = topic.split('/');
    const deviceId = parts[1];

    this.events.emit('device:message', { deviceId, topic, payload });
  }

  // ---------------------------------------------------------------------
  // Per-device subscribe / publish helpers, used by device.js
  // ---------------------------------------------------------------------

  subscribeDevice(deviceId) {
    if (!this.mqttClient) return;
    const topics = [
      `le/${deviceId}/prp/rpt`,     // status reports (push)
      `le/${deviceId}/prp/setr`,    // set responses
      `le/${deviceId}/prp/getr`,    // get responses
      `le/${deviceId}/act/exer`,    // action execute responses
    ];
    for (const t of topics) {
      this.mqttClient.subscribe(t, { qos: 0 });
    }
    this.log('Subscribed to topics for device', deviceId);
  }

  unsubscribeDevice(deviceId) {
    if (!this.mqttClient) return;
    const topics = [
      `le/${deviceId}/prp/rpt`,
      `le/${deviceId}/prp/setr`,
      `le/${deviceId}/prp/getr`,
      `le/${deviceId}/act/exer`,
    ];
    for (const t of topics) {
      this.mqttClient.unsubscribe(t);
    }
  }

  /**
   * Publish a "set" (prp/set) command to a device.
   * dpPayload should be the inner `d` object appropriate to the DP being set
   * (e.g. { "20": true } for on/off — CONFIRM actual DP codes via capture).
   */
  publishSet(deviceId, dpPayload) {
    if (!this.mqttClient || !this.mqttConnected) {
      throw new Error('MQTT not connected');
    }
    const envelope = {
      id: Math.floor(Math.random() * 1e9),
      d: dpPayload,
    };
    const topic = `le/${deviceId}/prp/set`;
    this.mqttClient.publish(topic, JSON.stringify(envelope), { qos: 0 });
  }

  /**
   * Request current state (prp/get). Response arrives async on prp/getr
   * and is emitted via `device:message`.
   */
  publishGet(deviceId, dpQuery) {
    if (!this.mqttClient || !this.mqttConnected) {
      throw new Error('MQTT not connected');
    }
    const envelope = {
      id: Math.floor(Math.random() * 1e9),
      d: dpQuery,
    };
    const topic = `le/${deviceId}/prp/get`;
    this.mqttClient.publish(topic, JSON.stringify(envelope), { qos: 0 });
  }

};