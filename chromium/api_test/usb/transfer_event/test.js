// Copyright (c) 2012 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const usb = chrome.usb

const tests = [
  function controlTransfer () {
    usb.findDevices({ vendorId: 0, productId: 0 }, function (devices) {
      const device = devices[0]
      const transfer = new Object()
      transfer.direction = 'out'
      transfer.recipient = 'device'
      transfer.requestType = 'standard'
      transfer.request = 1
      transfer.value = 2
      transfer.index = 3
      transfer.data = new ArrayBuffer(1)

      usb.controlTransfer(device, transfer, function (result) {
        chrome.test.assertNoLastError()
        chrome.test.succeed()
      })
    })
  },
  function bulkTransfer () {
    usb.findDevices({ vendorId: 0, productId: 0 }, function (devices) {
      const device = devices[0]
      const transfer = new Object()
      transfer.direction = 'out'
      transfer.endpoint = 1
      transfer.data = new ArrayBuffer(1)

      usb.bulkTransfer(device, transfer, function (result) {
        chrome.test.assertNoLastError()
        chrome.test.succeed()
      })
    })
  },
  function interruptTransfer () {
    usb.findDevices({ vendorId: 0, productId: 0 }, function (devices) {
      const device = devices[0]
      const transfer = new Object()
      transfer.direction = 'out'
      transfer.endpoint = 2
      transfer.data = new ArrayBuffer(1)

      usb.interruptTransfer(device, transfer, function (result) {
        chrome.test.assertNoLastError()
        chrome.test.succeed()
      })
    })
  },
  function isochronousTransfer () {
    usb.findDevices({ vendorId: 0, productId: 0 }, function (devices) {
      const device = devices[0]
      const transfer = new Object()
      transfer.direction = 'out'
      transfer.endpoint = 3
      transfer.data = new ArrayBuffer(1)

      const isoTransfer = new Object()
      isoTransfer.transferInfo = transfer
      isoTransfer.packets = 1
      isoTransfer.packetLength = 1

      usb.isochronousTransfer(device, isoTransfer, function (result) {
        chrome.test.assertNoLastError()
        chrome.test.succeed()
      })
    })
  }
]

chrome.test.runTests(tests)
