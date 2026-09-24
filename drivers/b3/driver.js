'use strict';

const Homey = require('homey');
const axios = require('axios');
const qs = require('querystring');

module.exports = class MyDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('MyDriver has been initialized');
  }

  async onPair(session) {
    session.setHandler('login', async (data) => {
      try {
        const email = data.email;
        const password = data.password;

        const regionData = qs.stringify({
          account: email,
          timestamp: Math.floor(Date.now() / 1000)
        });

        const urlResponse = await axios.post('https://api-eu-iot.lepro.com/user/region', regionData, {
          headers: {
            'App-Name': 'Lepro',
            'App-Version': '1.0.9.263',
            'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
            'Device-System': '16',
            'GMT': '+0',
            'Platform': '2',
            'Screen-Size': '1280*2856',
            'Timestamp': `${Math.floor(Date.now() / 1000)}`,
            'SLanguage': 'en',
            'Language': 'en',
            'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        const urlResponseData = urlResponse.data.data;
        const apiHost = urlResponseData.apiHost;
        const apiDeviceHost = urlResponseData.apiDeviceHost;

        const loginData = qs.stringify({
          platform: 2,
          account: email,
          password: password,
          mac: this.homey.cloud.getHomeyId(),
          timestamp: Math.floor(Date.now() / 1000),
          language: 'en',
          fcmToken: null
        });

        const loginResponse = await axios.post('https://api-eu-iot.lepro.com/user/login', loginData, {
          headers: {
            'App-Name': 'Lepro',
            'App-Version': '1.0.9.263',
            'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
            'Device-System': '16',
            'GMT': '+0',
            'Platform': '2',
            'Screen-Size': '1280*2856',
            'Timestamp': `${Math.floor(Date.now() / 1000)}`,
            'SLanguage': 'en',
            'Language': 'en',
            'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        const loginResponseData = loginResponse.data.data;
        this.homey.settings.set("apiHost",apiHost);
        this.homey.settings.set("apiDeviceHost",apiDeviceHost);
        this.homey.settings.set("uid",loginResponseData.uid);
        this.homey.settings.set("token",loginResponseData.token);
        this.homey.settings.set("secret",loginResponseData.secret);

        this.homey.app.secret = loginResponseData.secret;
        await this.homey.app.connectMqtt();
        await session.showView("list_devices");
        return true;
      } catch (error) {
        if (error.response) {
          this.log("Error response:", error.response.data);
        } else {
          this.log("Error:", error.message);
          this.log("Stack:",error.stack);
        }
        return false;
      }
    });
    session.setHandler('list_devices', async () => {
      const devices = await this.onPairListDevices();
      return devices;
    });
  }


  async onRepair(session) {
    session.setHandler('login', async (data) => {
      try {
        const email = data.email;
        const password = data.password;

        const regionData = qs.stringify({
          account: email,
          timestamp: Math.floor(Date.now() / 1000)
        });

        const urlResponse = await axios.post('https://api-eu-iot.lepro.com/user/region', regionData, {
          headers: {
            'App-Name': 'Lepro',
            'App-Version': '1.0.9.263',
            'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
            'Device-System': '16',
            'GMT': '+0',
            'Platform': '2',
            'Screen-Size': '1280*2856',
            'Timestamp': `${Math.floor(Date.now() / 1000)}`,
            'SLanguage': 'en',
            'Language': 'en',
            'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });
        const urlResponseData = urlResponse.data.data;
        const apiHost = urlResponseData.apiHost;
        const apiDeviceHost = urlResponseData.apiDeviceHost;

        const loginData = qs.stringify({
          platform: 2,
          account: email,
          password: password,
          mac: this.homey.cloud.getHomeyId(),
          timestamp: Math.floor(Date.now() / 1000),
          language: 'en',
          fcmToken: null
        });

        const loginResponse = await axios.post('https://api-eu-iot.lepro.com/user/login', loginData, {
          headers: {
            'App-Name': 'Lepro',
            'App-Version': '1.0.9.263',
            'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
            'Device-System': '16',
            'GMT': '+0',
            'Platform': '2',
            'Screen-Size': '1280*2856',
            'Timestamp': `${Math.floor(Date.now() / 1000)}`,
            'SLanguage': 'en',
            'Language': 'en',
            'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        const loginResponseData = loginResponse.data.data;
        this.homey.settings.set("apiHost",apiHost);
        this.homey.settings.set("apiDeviceHost",apiDeviceHost);
        this.homey.settings.set("uid",loginResponseData.uid);
        this.homey.settings.set("token",loginResponseData.token);
        this.homey.settings.set("secret",loginResponseData.secret);

        this.homey.app.secret = loginResponseData.secret;
        await this.homey.app.connectMqtt();
        await session.done();
        return true;
      } catch (error) {
        if (error.response) {
          this.log("Error response:", error.response.data);
        } else {
          this.log("Error:", error.message);
          this.log("Stack:",error.stack);
        }
        return false;
      }
    });
    session.setHandler('list_devices', async () => {
      const devices = await this.onPairListDevices();
      return devices;
    });
  }

  /**
   * onPairListDevices is called when a user is adding a device
   * and the 'list_devices' view is called.
   * This should return an array with the data of devices that are available for pairing.
   */
  async onPairListDevices() {
    this.log("Pairing devices");
    const getFamilyListResponse = await axios.get(`https://api-eu-iot.lepro.com/family/list/timestamp/${Math.floor(Date.now() / 1000)}`, {
      headers: {
        'App-Name': 'Lepro',
        'App-Version': '1.0.9.263',
        'Authorization': `Bearer ${this.homey.settings.get("token")}`,
        'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
        'Device-System': '16',
        'GMT': '+0',
        'Platform': '2',
        'Screen-Size': '1280*2856',
        'Timestamp': `${Math.floor(Date.now() / 1000)}`,
        'SLanguage': 'en',
        'Language': 'en',
        'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    this.log('Family list response:', getFamilyListResponse.data);

    const familyList = getFamilyListResponse.data.data.list;
    const devices = [];

    for (const family of familyList) {
      const getDeviceListResponse = await axios.get(`https://api-eu-iot.lepro.com/v3/device/list/fid/${family.fid}/timestamp/${Math.floor(Date.now() / 1000)}`, {
        headers: {
          'App-Name': 'Lepro',
          'App-Version': '1.0.9.263',
          'Authorization': `Bearer ${this.homey.settings.get("token")}`,
          'Device-Model': 'google/emu64xa/sdk_gphone64_x86_64/16',
          'Device-System': '16',
          'GMT': '+0',
          'Platform': '2',
          'Screen-Size': '1280*2856',
          'Timestamp': `${Math.floor(Date.now() / 1000)}`,
          'SLanguage': 'en',
          'Language': 'en',
          'user-agent': 'LE/1.0.9.263 (Android; google/emu64xa/sdk_gphone64_x86_64/16; OkHttp/4.2.1)',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      this.log('Device list response:', getDeviceListResponse.data);

      const deviceList = getDeviceListResponse.data.data.list;

      for (const device of deviceList) {
        this.log(`Found device: ${device.name}`);
        this.log(`Device ID: ${device.did}`);
        this.log(`Device proId: ${device.proId}`);
        this.log(`Device type: ${device.type}`);
        this.log(`Device subCategory: ${device.subCategory}`);
        this.log(`Device series: ${device.series}`);
        this.log(`Device family ID: ${device.fid}`);

        if (device.series === "B3") {
          devices.push({
            name: device.name,
            data: {
              id: device.did,
            },
            store: {
              proId: device.proId,
              type: device.type,
              subCategory: device.subCategory,
              series: device.series,
              familyId: device.fid,
              mac: device.mac
            },
          });
        }
      }
    }

    return devices;
  }

};
