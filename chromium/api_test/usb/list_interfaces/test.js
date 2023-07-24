// Copyright (c) 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const usb = chrome.usb

const tests = [
  function listInterfaces () {
    usb.findDevices({ vendorId: 0, productId: 0 }, function (devices) {
      const device = devices[0]
      usb.listInterfaces(device, function (result) {
        chrome.test.assertNoLastError()
        usb.closeDevice(device)
        chrome.test.succeed()
      })
    })
  }
]

chrome.test.runTests(tests)
