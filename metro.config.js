const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Avoid broken package-exports resolution for some Expo packages on Windows.
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
