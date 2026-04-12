const fs = require('fs');
const path = require('path');
const appJson = require('./app.json');

const config = appJson.expo || {};

const plugins = Array.isArray(config.plugins) ? [...config.plugins] : [];
if (!plugins.includes('expo-notifications')) {
  plugins.push('expo-notifications');
}
config.plugins = plugins;

const googleServicesPath = './google-services.json';
const absoluteGoogleServicesPath = path.join(__dirname, 'google-services.json');

config.android = config.android || {};
if (fs.existsSync(absoluteGoogleServicesPath)) {
  config.android.googleServicesFile = googleServicesPath;
} else {
  delete config.android.googleServicesFile;
}

module.exports = {
  expo: config,
};
