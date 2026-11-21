const { resolve } = require('node:path');
const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const { Command } = require('selenium-webdriver/lib/command');

async function checkInstall() {
  const driver = await new Builder().forBrowser('firefox')
    .setFirefoxOptions(new firefox.Options().addArguments('-headless').setPreference('xpinstall.signatures.required', true))
    .setFirefoxService(new firefox.ServiceBuilder('geckodriver').setHostname('127.0.0.1'))
    .build();
  try {
    const installed = await driver.execute(new Command('install addon')
      .setParameter('path', resolve(process.argv[2])).setParameter('temporary', false));
    const expected = require('../extension/manifest.json').browser_specific_settings.gecko.id;
    if (installed !== expected) throw new Error('Firefox installed an unexpected extension ID.');
    console.log(`Firefox accepted the permanent installation of ${installed}.`);
  } finally {
    await driver.quit();
  }
}

checkInstall().catch(error => { console.error(error); process.exitCode = 1; });
