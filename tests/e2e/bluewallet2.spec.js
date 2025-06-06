import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';

import {
  extractTextFromElementById,
  getSwitchValue,
  hashIt,
  helperImportWallet,
  sleep,
  waitForText,
  tapAndTapAgainIfElementIsNotVisible,
  tapAndTapAgainIfTextIsNotVisible,
  tapIfTextPresent,
  waitForId,
  countElements,
} from './helperz';

// if loglevel is set to `error`, this kind of logging will still get through
console.warn = console.log = (...args) => {
  let output = '';
  args.map(arg => (output += String(arg)));

  process.stdout.write(output + '\n');
};

/**
 * in this suite each test requires that there is one specific wallet present, thus, we import it
 * before anything else.
 * we dont clean it up as we expect other test suites to do clean install of the app
 */
beforeAll(async () => {
  if (!process.env.HD_MNEMONIC_BIP84) {
    console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
    return;
  }
  // reinstalling the app just for any case to clean up app's storage
  await device.launchApp({ delete: true });

  console.log('before all - importing bip84...');
  await helperImportWallet(process.env.HD_MNEMONIC_BIP84, 'HDsegwitBech32', 'Imported HD SegWit (BIP84 Bech32 Native)', '0.00105526');
  console.log('...imported!');
  await device.pressBack();
  await sleep(15000);
}, 1200_000);

describe('BlueWallet UI Tests - import BIP84 wallet', () => {
  it('can create a transaction; can scanQR with bip21; can switch units', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t21');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t21'), 'as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();

    // lets create real transaction:
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();
    await element(by.id('AddressInput')).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('BitcoinAmountInput')).typeText('0.0001\n');

    // setting fee rate:
    const feeRate = 2;
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText(feeRate + '\n');
    await element(by.text('OK')).tap();

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}

    // created. verifying:
    await waitForId('TransactionValue');
    await expect(element(by.id('TransactionValue'))).toHaveText('0.0001');
    const transactionFee = await extractTextFromElementById('TransactionFee');
    assert.ok(transactionFee.startsWith('Fee: 0.00000292 BTC'), 'Unexpected tx fee: ' + transactionFee);
    await element(by.id('TransactionDetailsButton')).tap();

    let txhex = await extractTextFromElementById('TxhexInput');

    let transaction = bitcoin.Transaction.fromHex(txhex);
    assert.ok(transaction.ins.length === 1 || transaction.ins.length === 2); // depending on current fees gona use either 1 or 2 inputs
    assert.strictEqual(transaction.outs.length, 2);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl'); // to address
    assert.strictEqual(transaction.outs[0].value, 10000);

    // checking fee rate:
    const totalIns = 69909; // we hardcode it since we know it in advance
    const totalOuts = transaction.outs.map(el => el.value).reduce((a, b) => a + b, 0);
    const tx = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(Math.round((totalIns - totalOuts) / tx.virtualSize()), feeRate);
    assert.strictEqual(transactionFee.split(' ')[1] * 100000000, totalIns - totalOuts);

    if (device.getPlatform() === 'ios') {
      console.warn('rest of the test is Android only, skipped');
      return;
    }

    // now, testing scanQR with bip21:

    await device.pressBack();
    await device.pressBack();
    await element(by.id('changeAmountUnitButton')).tap(); // switched to SATS
    await element(by.id('BlueAddressInputScanQrButton')).tap();

    // tapping 5 times invisible button is a backdoor:
    for (let c = 0; c <= 5; c++) {
      await element(by.id('ScanQrBackdoorButton')).tap();
      await sleep(1000);
    }

    const bip21 = 'bitcoin:bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7?amount=0.00015&pj=https://btc.donate.kukks.org/BTC/pj';
    await element(by.id('scanQrBackdoorInput')).replaceText(bip21);
    await element(by.id('scanQrBackdoorOkButton')).tap();

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}
    // created. verifying:
    await waitForId('TransactionValue');
    await waitForId('PayjoinSwitch');
    await element(by.id('TransactionDetailsButton')).tap();
    txhex = await extractTextFromElementById('TxhexInput');
    transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    assert.strictEqual(transaction.outs[0].value, 15000);

    // now, testing scanQR with just address after amount set to 1.1 USD. Denomination should not change after qrcode scan

    await device.pressBack();
    await device.pressBack();
    await element(by.id('changeAmountUnitButton')).tap(); // switched to SATS
    await element(by.id('changeAmountUnitButton')).tap(); // switched to FIAT
    await element(by.id('BitcoinAmountInput')).replaceText('1.1');
    await element(by.id('BlueAddressInputScanQrButton')).tap();

    // tapping 5 times invisible button is a backdoor:
    for (let c = 0; c <= 5; c++) {
      await element(by.id('ScanQrBackdoorButton')).tap();
      await sleep(1000);
    }

    await element(by.id('scanQrBackdoorInput')).replaceText('bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    await element(by.id('scanQrBackdoorOkButton')).tap();

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}
    // created. verifying:
    await waitForId('TransactionValue');
    await waitForId('PayjoinSwitch');
    await element(by.id('TransactionDetailsButton')).tap();
    txhex = await extractTextFromElementById('TxhexInput');
    transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    assert.notEqual(transaction.outs[0].value, 110000000); // check that it is 1.1 USD, not 1 BTC
    assert.ok(transaction.outs[0].value < 10000); // 1.1 USD ~ 0,00001964 sats in march 2021

    // now, testing units switching, and then creating tx with SATS:

    await device.pressBack();
    await device.pressBack();
    await element(by.id('changeAmountUnitButton')).tap(); // switched to BTC
    await element(by.id('BitcoinAmountInput')).replaceText('0.00015');
    await element(by.id('changeAmountUnitButton')).tap(); // switched to sats
    assert.strictEqual(await extractTextFromElementById('BitcoinAmountInput'), '15000');
    await element(by.id('changeAmountUnitButton')).tap(); // switched to FIAT
    await element(by.id('changeAmountUnitButton')).tap(); // switched to BTC
    assert.strictEqual(await extractTextFromElementById('BitcoinAmountInput'), '0.00015');
    await element(by.id('changeAmountUnitButton')).tap(); // switched to sats
    await element(by.id('BitcoinAmountInput')).replaceText('50000');

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}
    // created. verifying:
    await waitForId('TransactionValue');
    await element(by.id('TransactionDetailsButton')).tap();
    txhex = await extractTextFromElementById('TxhexInput');
    transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(transaction.outs.length, 2);
    assert.strictEqual(transaction.outs[0].value, 50000);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can batch send', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t_batch_send');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // Go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();

    // Add a few recipients initially
    await element(by.id('AddressInput')).replaceText('bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    await element(by.id('BitcoinAmountInput')).replaceText('0.0001\n');

    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await waitForId('Transaction1');
    await element(by.id('AddressInput').withAncestor(by.id('Transaction1'))).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('BitcoinAmountInput').withAncestor(by.id('Transaction1'))).replaceText('0.0002\n');

    // Now remove all recipients before proceeding
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Remove All Recipients')).tap();
    await element(by.text('OK')).tap();

    // Now, let's proceed with the batch send process again
    // Let's create a real transaction again:
    await element(by.id('AddressInput')).replaceText('bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    await element(by.id('BitcoinAmountInput')).replaceText('0.0001\n');

    // Setting fee rate:
    const feeRate = 2;
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText(feeRate + '\n');
    await element(by.text('OK')).tap();

    // Let's add another two outputs
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await waitForId('Transaction1'); // Adding a recipient autoscrolls it to the last one
    await element(by.id('AddressInput').withAncestor(by.id('Transaction1'))).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('BitcoinAmountInput').withAncestor(by.id('Transaction1'))).replaceText('0.0002\n');

    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await waitForId('Transaction2'); // Adding a recipient autoscrolls it to the last one
    await element(by.id('AddressInput').withAncestor(by.id('Transaction2'))).replaceText('bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7');
    await element(by.id('BitcoinAmountInput').withAncestor(by.id('Transaction2'))).replaceText('0.0003\n');

    // Remove last output, check if second output is shown
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Remove Recipient')).tap();
    await waitForId('Transaction1');

    // Add it again
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await waitForId('Transaction2'); // Adding a recipient autoscrolls it to the last one
    await element(by.id('AddressInput').withAncestor(by.id('Transaction2'))).replaceText('bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7');
    await element(by.id('BitcoinAmountInput').withAncestor(by.id('Transaction2'))).replaceText('0.0003\n');

    // Remove second output
    await element(by.id('Transaction2')).swipe('right', 'fast', NaN, 0.2);
    await sleep(5000);
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Remove Recipient')).tap();

    // Creating and verifying. tx should have 3 outputs
    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}

    await element(by.id('TransactionDetailsButton')).tap();
    const txhex = await extractTextFromElementById('TxhexInput');
    const transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(transaction.outs.length, 3);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    assert.strictEqual(transaction.outs[0].value, 10000);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[1].script), 'bc1qh6tf004ty7z7un2v5ntu4mkf630545gvhs45u7');
    assert.strictEqual(transaction.outs[1].value, 30000, `got txhex ${txhex}`);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can sendMAX', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t_sendMAX');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();

    // set fee rate
    const feeRate = 2;
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText(feeRate + '\n');
    await element(by.text('OK')).tap();

    // first send MAX output
    await element(by.id('AddressInput')).replaceText('bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    await element(by.id('BitcoinAmountInput')).typeText('0.0001\n');
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Use Full Balance')).tap();
    await element(by.text('OK')).tap();

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}
    // created. verifying:
    await waitForId('TransactionDetailsButton');
    await element(by.id('TransactionDetailsButton')).tap();
    let txhex = await extractTextFromElementById('TxhexInput');
    let transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(transaction.outs.length, 1, 'should be single output, no change');
    assert.ok(transaction.outs[0].value > 100000);

    // add second output with amount
    await device.pressBack();
    await device.pressBack();
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await waitForId('Transaction1');
    await element(by.id('AddressInput').withAncestor(by.id('Transaction1'))).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('BitcoinAmountInput').withAncestor(by.id('Transaction1'))).typeText('0.0001\n');

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}
    // created. verifying:
    await waitForId('TransactionDetailsButton');
    await element(by.id('TransactionDetailsButton')).tap();
    txhex = await extractTextFromElementById('TxhexInput');
    transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(transaction.outs.length, 2, 'should be single output, no change');
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1qnapskphjnwzw2w3dk4anpxntunc77v6qrua0f7');
    assert.ok(transaction.outs[0].value > 50000);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[1].script), 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    assert.strictEqual(transaction.outs[1].value, 10000);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can cosign psbt', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t_cosign');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();

    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Sign a transaction')).tap();

    // tapping 5 times invisible button is a backdoor:
    for (let c = 0; c <= 5; c++) {
      await element(by.id('ScanQrBackdoorButton')).tap();
      await sleep(1000);
    }
    // 1 input, 2 outputs. wallet can fully sign this tx
    const psbt =
      'cHNidP8BAFICAAAAAXYa7FEQBAQ2X0B48aHHKKgzkVuHfQ2yCOi3v9RR0IqlAQAAAAAAAACAAegDAAAAAAAAFgAUSnH40G+jiJfreeRb36cs641KFm8AAAAAAAEBH5YVAAAAAAAAFgAUTKHjDm4OJQSbvy9uzyLYi5i5XIoiBgMQcGrP5TIMrdvb73yB4WnZvkPzKr1EzJXJYBHWmlPJZRgAAAAAVAAAgAAAAIAAAACAAQAAAD4AAAAAAA==';
    await element(by.id('scanQrBackdoorInput')).replaceText(psbt);
    await element(by.id('scanQrBackdoorOkButton')).tap();

    // this is fully-signed tx, "this is tx hex" help text should appear
    await waitForId('DynamicCode');

    const txhex = await extractTextFromElementById('TxhexInput');
    console.warn(txhex);
    const transaction = bitcoin.Transaction.fromHex(txhex);
    assert.strictEqual(transaction.ins.length, 1);
    assert.strictEqual(transaction.outs.length, 1);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1qffcl35r05wyf06meu3dalfevawx559n0ufrxcw'); // to address
    assert.strictEqual(transaction.outs[0].value, 1000);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('payment codes & manage contacts', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t_manage_contacts');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await element(by.id('WalletDetails')).tap();

    // switch on BIP47 slider if its not switched
    if (!(await getSwitchValue('BIP47Switch'))) {
      await expect(element(by.text('Contacts'))).not.toBeVisible();
      await element(by.id('BIP47Switch')).tap();
      await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1);
      await expect(element(by.text('Contacts'))).toBeVisible();
      await device.pressBack();
    } else {
      await device.pressBack();
    }

    // go to receive screen and check that payment code is there

    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();

    try {
      await element(by.text('ASK ME LATER.')).tap();
    } catch (_) {}

    await element(by.text('Payment Code')).tap();
    await element(by.id('ReceiveDetailsScrollView')).swipe('up', 'fast', 1); // in case emu screen is small and it doesnt fit

    await expect(
      element(
        by.text('PM8TJbcHbQFgBL5mAYUCxJEhsz8F66abWAnVqiq6Pa8Rav8qG6XjaJQmSzNqgc1k63ipiEnobNpAoxNJVzRkdoUEANj9KyBEjLt4hL99RMoa8iJXwwwM'),
      ),
    ).toBeVisible();

    // now, testing contacts list
    await device.pressBack();
    await device.pressBack();
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await element(by.id('WalletDetails')).tap();
    await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1); // in case emu screen is small and it doesnt fit
    await tapAndTapAgainIfTextIsNotVisible('Contacts', 'Add Contact');

    await expect(element(by.id('ContactListItem0'))).not.toBeVisible();
    await element(by.text('Add Contact')).tap();
    await element(by.type('android.widget.EditText')).replaceText('13HaCAB4jf7FYSZexJxoczyDDnutzZigjS');
    await sleep(1000);
    await element(by.text('OK')).tap();
    await element(by.text('Add Contact')).tap();
    await element(by.type('android.widget.EditText')).replaceText(
      'sp1qqgste7k9hx0qftg6qmwlkqtwuy6cycyavzmzj85c6qdfhjdpdjtdgqjuexzk6murw56suy3e0rd2cgqvycxttddwsvgxe2usfpxumr70xc9pkqwv',
    );
    await element(by.text('OK')).tap();

    await expect(element(by.id('ContactListItem0'))).toBeVisible();
    await expect(element(by.id('ContactListItem1'))).toBeVisible();

    await element(by.text('Add Contact')).tap();
    await element(by.type('android.widget.EditText')).replaceText(
      'PM8TJS2JxQ5ztXUpBBRnpTbcUXbUHy2T1abfrb3KkAAtMEGNbey4oumH7Hc578WgQJhPjBxteQ5GHHToTYHE3A1w6p7tU6KSoFmWBVbFGjKPisZDbP97',
    );
    await element(by.text('OK')).tap();

    await waitForText('On-chain transaction needed');
    await element(by.text('Cancel')).tap();

    // testing renaming contact:
    await element(by.id('ContactListItem0')).tap();
    await element(by.text('Rename contact')).tap();
    await element(by.type('android.widget.EditText')).replaceText('c0ntact');
    await element(by.text('OK')).tap();
    await expect(element(by.text('c0ntact'))).toBeVisible();

    // now, doing a real transaction with our contacts

    await device.pressBack();
    await device.pressBack();
    await device.pressBack();
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await waitForId('SendButton');

    await tapAndTapAgainIfElementIsNotVisible('SendButton', 'HeaderMenuButton');
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Insert Contact')).tap();
    await tapAndTapAgainIfElementIsNotVisible('ContactListItem0', 'BitcoinAmountInput');
    await element(by.id('BitcoinAmountInput')).typeText('0.0001\n');

    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Add Recipient')).tap();
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Insert Contact')).tap();
    await element(by.id('ContactListItem1')).tap();
    await element(by.id('BitcoinAmountInput')).atIndex(1).typeText('0.0002\n');
    await sleep(1000);
    // setting fee rate:
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText('1\n');
    await element(by.text('OK')).tap();
    await sleep(1000);

    await element(by.id('CreateTransactionButton')).tap();
    await element(by.id('TransactionDetailsButton')).tap();

    const txhex1 = await extractTextFromElementById('TxhexInput');
    const tx1 = bitcoin.Transaction.fromHex(txhex1);
    assert.strictEqual(tx1.outs.length, 3);
    assert.strictEqual(tx1.outs[0].script.toString('hex'), '76a91419129d53e6319baf19dba059bead166df90ab8f588ac');
    assert.strictEqual(tx1.outs[0].value, 10000);
    assert.strictEqual(tx1.outs[1].script.toString('hex'), '5120b81959cd9a4954cd525916cd636b4ffe9466600412ccd162653a0f464489f1a8');
    assert.strictEqual(tx1.outs[1].value, 20000);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can do basic wallet-details operations', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t_walletdetails');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();

    // let's test wallet details screens
    await element(by.id('WalletDetails')).tap();

    // rename test
    await element(by.id('WalletNameInput')).replaceText('testname');
    await element(by.id('WalletNameInput')).typeText('\n'); // newline is what triggers saving the wallet
    await device.pressBack();
    await waitForText('testname');
    await expect(element(by.id('WalletLabel'))).toHaveText('testname');
    await element(by.id('WalletDetails')).tap();

    // rename back
    await element(by.id('WalletNameInput')).replaceText('Imported HD SegWit (BIP84 Bech32 Native)');
    await element(by.id('WalletNameInput')).typeText('\n'); // newline is what triggers saving the wallet
    await device.pressBack();
    await waitForText('Imported HD SegWit (BIP84 Bech32 Native)');
    await expect(element(by.id('WalletLabel'))).toHaveText('Imported HD SegWit (BIP84 Bech32 Native)');
    await element(by.id('WalletDetails')).tap();

    // wallet export
    await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1);
    await tapAndTapAgainIfElementIsNotVisible('WalletExport', 'WalletExportScroll');
    await element(by.id('WalletExportScroll')).swipe('up', 'fast', 1);
    await expect(element(by.id('Secret'))).toHaveText(process.env.HD_MNEMONIC_BIP84);
    await device.pressBack();

    // XPUB
    await element(by.id('WalletDetailsScroll')).swipe('up', 'fast', 1);
    await tapAndTapAgainIfElementIsNotVisible('XpubButton', 'CopyTextToClipboard');
    await device.pressBack();

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('should handle URL successfully', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t22');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t22'), 'as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });

    await device.launchApp({
      newInstance: true,
      url: 'bitcoin:BC1QH6TF004TY7Z7UN2V5NTU4MKF630545GVHS45U7?amount=0.0001&label=Yo',
    });

    // setting fee rate:
    const feeRate = 2;
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText(feeRate + '\n');
    await element(by.text('OK')).tap();

    if (process.env.TRAVIS) await sleep(5000);
    try {
      await element(by.id('CreateTransactionButton')).tap();
    } catch (_) {}

    // created. verifying:
    await waitForId('TransactionValue');
    await expect(element(by.id('TransactionValue'))).toHaveText('0.0001');
    await expect(element(by.id('TransactionAddress'))).toHaveText('BC1QH6TF004TY7Z7UN2V5NTU4MKF630545GVHS45U7');

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can manage UTXO', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t23');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t23'), 'as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });
    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();

    await waitFor(element(by.id('NoTxBuyBitcoin')))
      .not.toExist()
      .withTimeout(300 * 1000);

    // change note of 0.00069909 tx output
    await element(by.text('0.00069909')).atIndex(0).tap();
    await element(by.text('Details')).tap();
    await expect(element(by.text('8b0ab2c7196312e021e0d3dc73f801693826428782970763df6134457bd2ec20'))).toBeVisible();
    await element(by.type('android.widget.EditText')).replaceText('test1');
    await element(by.type('android.widget.EditText')).tapReturnKey();

    // Terminate and reopen the app to confirm the note is persisted
    await device.launchApp({ newInstance: true });
    await waitForId('WalletsList');
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Coin Control')).tap();
    await waitFor(element(by.id('Loading'))) // wait for outputs to be loaded
      .not.toExist()
      .withTimeout(300 * 1000);
    await expect(element(by.text('test1')).atIndex(0)).toBeVisible();

    // change output note and freeze it
    await element(by.text('test1')).atIndex(0).tap();
    await element(by.id('OutputMemo')).replaceText('test2');
    await element(by.type('android.widget.CompoundButton')).tap(); // freeze switch
    await element(by.id('ModalDoneButton')).tap();
    await expect(element(by.text('test2')).atIndex(0)).toBeVisible();
    await expect(element(by.text('Freeze')).atIndex(0)).toBeVisible();

    // use frozen output to create tx using "Use coin" feature
    await element(by.text('test2')).atIndex(0).tap();
    await element(by.id('UseCoin')).tap();
    await element(by.id('AddressInput')).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Use Full Balance')).tap();
    await element(by.text('OK')).tap();
    // setting fee rate:
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).replaceText('1');
    await element(by.type('android.widget.EditText')).tapReturnKey();
    await element(by.text('OK')).tap();
    await tapIfTextPresent('OK'); // in case it didnt work first time
    await sleep(3000);
    await element(by.id('CreateTransactionButton')).tap();
    await element(by.id('TransactionDetailsButton')).tap();

    const txhex1 = await extractTextFromElementById('TxhexInput');
    const tx1 = bitcoin.Transaction.fromHex(txhex1);
    assert.strictEqual(tx1.outs.length, 1);
    assert.strictEqual(tx1.outs[0].script.toString('hex'), '00147ea385f352be696ab0f6e94a0ee0e3c6d4b14a53');
    assert.strictEqual(tx1.outs[0].value, 69797);
    assert.strictEqual(tx1.ins.length, 1);
    assert.strictEqual(tx1.ins[0].hash.toString('hex'), '20ecd27b453461df63079782874226386901f873dcd3e021e0126319c7b20a8b');
    assert.strictEqual(tx1.ins[0].index, 0);

    // back to wallet screen
    await device.pressBack();
    await device.pressBack();
    await device.pressBack();

    // create tx with unfrozen input
    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();
    await element(by.id('AddressInput')).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('HeaderMenuButton')).tap();
    await element(by.text('Use Full Balance')).tap();
    await element(by.text('OK')).tap();
    // setting fee rate:
    await element(by.id('chooseFee')).tap();
    await element(by.id('feeCustom')).tap();
    await element(by.type('android.widget.EditText')).typeText('1\n');
    await element(by.text('OK')).tap();
    if (process.env.TRAVIS) await sleep(5000);
    await element(by.id('CreateTransactionButton')).tap();
    await element(by.id('TransactionDetailsButton')).tap();

    const txhex2 = await extractTextFromElementById('TxhexInput');
    const tx2 = bitcoin.Transaction.fromHex(txhex2);

    assert.strictEqual(tx2.outs.length, 1);
    assert.strictEqual(tx2.outs[0].script.toString('hex'), '00147ea385f352be696ab0f6e94a0ee0e3c6d4b14a53');
    assert.strictEqual(tx2.outs[0].value, 35369);
    assert.strictEqual(tx2.ins.length, 3);
    assert.strictEqual(tx2.ins[0].hash.toString('hex'), 'd479264875a0f7c4a84e47141be005404531a8655f2388ae21e89a9701f14c10');
    assert.strictEqual(tx2.ins[0].index, 0);

    process.env.TRAVIS && require('fs').writeFileSync(lockFile, '1');
  });

  it('can purge txs and balance, then refetch data from tx list screen and see data on screen update', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t24');
    if (process.env.TRAVIS) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t24'), 'as it previously passed on Travis');
    }
    if (!process.env.HD_MNEMONIC_BIP84) {
      console.error('process.env.HD_MNEMONIC_BIP84 not set, skipped');
      return;
    }

    await device.launchApp({ newInstance: true });
    // go inside the wallet
    await element(by.text('Imported HD SegWit (BIP84 Bech32 Native)')).tap();
    await element(by.id('WalletDetails')).tap();

    // tapping backdoor button to purge txs and balance:
    for (let c = 0; c <= 10; c++) {
      await element(by.id('PurgeBackdoorButton')).tap();
      await sleep(500);
    }

    await waitForText('OK');
    await tapIfTextPresent('OK');

    if (device.getPlatform() === 'ios') {
      console.warn('rest of the test is Android only, skipped');
      return;
    }

    await device.pressBack();

    // asserting there are no transactions and balance is 0:

    await expect(element(by.id('WalletBalance'))).toHaveText('0');
    await waitForId('TransactionsListEmpty');
    assert.strictEqual(await countElements('TransactionListItem'), 0);

    await element(by.id('TransactionsListView')).swipe('down', 'slow'); // pul-to-refresh

    // asserting balance and txs loaded:
    await waitForText('0.00105526'); // the wait inside allows network request to propagate
    await waitFor(element(by.id('TransactionsListEmpty')))
      .not.toBeVisible()
      .withTimeout(25_000);
    await expect(element(by.id('WalletBalance'))).toHaveText('0.00105526');
    await expect(element(by.id('TransactionsListEmpty'))).not.toBeVisible();

    assert.ok((await countElements('TransactionListItem')) >= 3); // 3 is arbitrary, real txs on screen depend on screen size
  });
});
