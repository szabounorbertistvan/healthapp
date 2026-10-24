// Metro for the npm-workspaces monorepo. Expo's default config already watches
// the workspace root and resolves the hoisted node_modules; one thing it cannot
// know is that this app needs a different React from the web's.
//
// React Native's renderer must run with exactly the React it was built for
// (SDK 58: react 19.3.0), while apps/web is on the 19.2 line. npm therefore
// installs this app's React under apps/mobile/node_modules and keeps the web's
// at the root — and any hoisted package (expo-router, react-native-screens…)
// would find the root copy first. Two Reacts in one bundle is the classic
// "Invalid hook call" crash, so every `react` (and `react-dom`) import is pinned to ours.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);

// react-dom too, for the web preview (react-native-web is hoisted and would
// otherwise pick the web app's react-dom).
const pinned = (name) =>
  name === "react" || name.startsWith("react/") || name === "react-dom" || name.startsWith("react-dom/");

const defaultResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolve ?? context.resolveRequest;
  if (pinned(moduleName)) {
    return resolve(
      { ...context, originModulePath: path.join(__dirname, "package.json") },
      moduleName,
      platform,
    );
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
