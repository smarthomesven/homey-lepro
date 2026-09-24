'use strict';

const Homey = require('homey');

/**
 * DP Code table:
 *   d1 = on/off              int 0/1
 *   d2 = work mode           int 0 = white/temp mode, 1 = color mode
 *   d3 = white brightness    int 0-1000 (only meaningful/reported in white mode)
 *   d4 = color temperature   int 0-1000 (warm/cool direction not yet confirmed)
 *   d5 = HSV color           12-hex string: hue(0-360) + sat(0-1000) + val(0-1000),
 *                            each as 4-hex-digit zero-padded. val here doubles as
 *                            brightness while in color mode.
 **/
const DP_CODES = {
  ON_OFF: 'd1',
  WORK_MODE: 'd2',
  WHITE_BRIGHTNESS: 'd3',
  COLOR_TEMP: 'd4',
  COLOR_HSV: 'd5',
};

const WORK_MODE_WHITE = 0;
const WORK_MODE_COLOR = 1;

function encodeHsv(hue, sat, val) {
  const h = clamp(hue, 0, 360).toString(16).padStart(4, '0');
  const s = clamp(sat, 0, 1000).toString(16).padStart(4, '0');
  const v = clamp(val, 0, 1000).toString(16).padStart(4, '0');
  return (h + s + v).toUpperCase();
}

function decodeHsv(hex) {
  return {
    hue: parseInt(hex.slice(0, 4), 16),
    sat: parseInt(hex.slice(4, 8), 16),
    val: parseInt(hex.slice(8, 12), 16),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

module.exports = class LeproDevice extends Homey.Device {

  async onInit() {
    this.deviceId = this.getData().id; // `did` from the driver's device list
    this.log('Init Lepro device', this.getName(), 'did:', this.deviceId);

    // Local cache of last-known HSV/mode so a single-capability change
    // (e.g. just hue) can be combined with the other two values when
    // publishing d5, rather than clobbering sat/val with stale defaults.
    this._state = {
      workMode: WORK_MODE_WHITE,
      hue: 0,
      sat: 1000,
      val: 1000,
    };

    this._onMessage = this._onMessage.bind(this);
    this.homey.app.events.on('device:message', this._onMessage);

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', this._setOnOff.bind(this));
    }
    if (this.hasCapability('dim')) {
      this.registerCapabilityListener('dim', this._setDim.bind(this));
    }
    if (this.hasCapability('light_temperature')) {
      this.registerCapabilityListener('light_temperature', this._setColorTemp.bind(this));
    }
    if (this.hasCapability('light_hue')) {
      this.registerCapabilityListener('light_hue', this._setHue.bind(this));
    }
    if (this.hasCapability('light_saturation')) {
      this.registerCapabilityListener('light_saturation', this._setSaturation.bind(this));
    }
    if (this.hasCapability('light_mode')) {
      this.registerCapabilityListener('light_mode', this._setLightMode.bind(this));
    }

    // Refresh status on every MQTT (re)connect. Covers both the normal case
    // (device inits before the app's MQTT client connects) and the race
    // where the app already connected a moment earlier — in that case
    // `mqttConnected` is already true, so request immediately instead of
    // waiting for an event that already fired.
    this._onMqttConnect = () => {
      this.homey.app.subscribeDevice(this.deviceId);
      this._requestStatus();
    };
    this.homey.app.events.on('mqtt:connect', this._onMqttConnect);
    if (this.homey.app.mqttConnected) {
      this._onMqttConnect();
    }

    this._pollInterval = this.homey.setInterval(() => {
      this._requestStatus();
    }, 5 * 60 * 1000); // every 5 minutes
  }

  async onDeleted() {
    this.homey.app.events.off('device:message', this._onMessage);
    this.homey.app.events.off('mqtt:connect', this._onMqttConnect);
    this.homey.app.unsubscribeDevice(this.deviceId);
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
    }
  }

  async _setOnOff(value) {
    this.homey.app.publishSet(this.deviceId, { [DP_CODES.ON_OFF]: value ? 1 : 0 });
  }

  async _setLightMode(mode) {
    this._state.workMode = mode === 'color' ? WORK_MODE_COLOR : WORK_MODE_WHITE;
    this.homey.app.publishSet(this.deviceId, { [DP_CODES.WORK_MODE]: this._state.workMode });
  }

  async _setDim(value) {
    const level = clamp(value * 1000, 0, 1000);
    if (this._state.workMode === WORK_MODE_COLOR) {
      this._state.val = level;
      this.homey.app.publishSet(this.deviceId, {
        [DP_CODES.COLOR_HSV]: encodeHsv(this._state.hue, this._state.sat, this._state.val),
      });
    } else {
      this.homey.app.publishSet(this.deviceId, { [DP_CODES.WHITE_BRIGHTNESS]: level });
    }
  }

  async _setColorTemp(value) {
    let tempValue = clamp(value * 1000, 0, 1000);
    tempValue = 1000 - tempValue;

    // Setting color temp implies white mode.
    if (this._state.workMode !== WORK_MODE_WHITE) {
      this._state.workMode = WORK_MODE_WHITE;
      this.homey.app.publishSet(this.deviceId, { [DP_CODES.WORK_MODE]: WORK_MODE_WHITE });
    }
    this.homey.app.publishSet(this.deviceId, { [DP_CODES.COLOR_TEMP]: tempValue });
  }

  async _setHue(value) {
    this._state.hue = clamp(value * 360, 0, 360);
    await this._publishColorMode();
  }

  async _setSaturation(value) {
    this._state.sat = clamp(value * 1000, 0, 1000);
    await this._publishColorMode();
  }

  async _publishColorMode() {
    if (this._state.workMode !== WORK_MODE_COLOR) {
      this._state.workMode = WORK_MODE_COLOR;
      this.homey.app.publishSet(this.deviceId, { [DP_CODES.WORK_MODE]: WORK_MODE_COLOR });
    }
    this.homey.app.publishSet(this.deviceId, {
      [DP_CODES.COLOR_HSV]: encodeHsv(this._state.hue, this._state.sat, this._state.val),
    });
  }

  _requestStatus() {
    try {
      this.homey.app.publishGet(this.deviceId, {});
    } catch (err) {
      this.log('Could not request status yet (MQTT not ready):', err.message);
    }
  }
  _onMessage({ deviceId, topic, payload }) {
    if (String(deviceId) !== String(this.deviceId)) return;
    if (this._availabilityTimeout) {
      this.homey.clearTimeout(this._availabilityTimeout);
      this._availabilityTimeout = null;
    }
    this.setAvailable().catch((err) => this.error(err));

    const dp = payload && payload.d ? payload.d : payload;
    if (!dp || typeof dp !== 'object') return;

    if (DP_CODES.ON_OFF in dp && this.hasCapability('onoff')) {
      this.setCapabilityValue('onoff', !!dp[DP_CODES.ON_OFF]).catch((err) => this.error(err));
    }

    if (DP_CODES.WORK_MODE in dp) {
      this._state.workMode = dp[DP_CODES.WORK_MODE];
      if (this.hasCapability('light_mode')) {
        this.setCapabilityValue('light_mode', this._state.workMode === WORK_MODE_COLOR ? 'color' : 'temperature').catch((err) => this.error(err));
      }
    }

    if (DP_CODES.WHITE_BRIGHTNESS in dp && this.hasCapability('dim')) {
      this.setCapabilityValue('dim', Number(dp[DP_CODES.WHITE_BRIGHTNESS]) / 1000).catch((err) => this.error(err));
    }

    if (DP_CODES.COLOR_TEMP in dp && this.hasCapability('light_temperature')) {
      let t = Number(dp[DP_CODES.COLOR_TEMP]) / 1000;
      t = 1 - t;
      this.setCapabilityValue('light_temperature', t).catch((err) => this.error(err));
    }

    if (DP_CODES.COLOR_HSV in dp) {
      const { hue, sat, val } = decodeHsv(dp[DP_CODES.COLOR_HSV]);
      this._state.hue = hue;
      this._state.sat = sat;
      this._state.val = val;
      if (this.hasCapability('light_hue')) {
        this.setCapabilityValue('light_hue', hue / 360).catch((err) => this.error(err));
      }
      if (this.hasCapability('light_saturation')) {
        this.setCapabilityValue('light_saturation', sat / 1000).catch((err) => this.error(err));
      }
      if (this.hasCapability('dim') && this._state.workMode === WORK_MODE_COLOR) {
        this.setCapabilityValue('dim', val / 1000).catch((err) => this.error(err));
      }
    }
  }

};