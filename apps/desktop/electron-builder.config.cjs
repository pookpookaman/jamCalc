/**
 * Packaging, Windows first.
 *
 * The product name is read from package.json, and everything here that shows
 * it — the file type, the shortcut, the publisher — is derived from it, so a
 * rename is one line there and nothing here.
 *
 * Unsigned until there is a certificate. electron-builder signs automatically
 * when CSC_LINK and CSC_KEY_PASSWORD are set, so signing needs no change here.
 */

const { productName } = require("./package.json");

module.exports = {
  // Windows keys the install, its uninstall entry and taskbar grouping on this.
  // It follows the name until the first public installer ships, and must never
  // change after that: a new id installs as a different application.
  appId: `app.${productName.toLowerCase()}.desktop`,
  productName,
  copyright: `Copyright © 2026 ${productName} contributors`,

  directories: { output: "release", buildResources: "resources" },
  files: ["dist/**/*", "renderer/**/*", "package.json"],
  // The publisher Windows shows in its list of installed apps.
  extraMetadata: { author: { name: productName } },

  // Electron's binary does not come from npm on every machine. Packaging
  // uses the one already in node_modules rather than downloading a second copy.
  electronDist: "../../node_modules/electron/dist",
  electronVersion: require("electron/package.json").version,

  asar: true,

  // Beside the program, next to Electron's and Chromium's own licence files:
  // MIT asks that every copy carry the notices (THIRD-PARTY.md, from
  // `npm run notices`).
  extraFiles: [
    { from: "../../LICENSE", to: "LICENSE.txt" },
    { from: "../../THIRD-PARTY.md", to: "THIRD-PARTY.md" },
  ],

  win: {
    target: [
      { target: "nsis", arch: ["x64"] },
      // Engineering IT departments vary: some allow installers, some only a
      // program that runs from a folder.
      { target: "portable", arch: ["x64"] },
    ],
    icon: "resources/icon.ico",
  },

  nsis: {
    // An assisted installer: it asks whether to install for this user or for
    // everyone, and where. Installing for this user needs no administrator.
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
    artifactName: "${productName}-Setup-${version}.${ext}",
  },

  portable: {
    artifactName: "${productName}-Portable-${version}.${ext}",
  },

  fileAssociations: [
    {
      ext: "jc",
      name: `${productName} sheet`,
      description: `${productName} calculation sheet`,
      icon: "resources/icon.ico",
      role: "Editor",
    },
  ],

  // No update channel yet: it needs somewhere to publish releases.
  publish: null,
};
