// Copyright 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

chrome.usb.onDeviceAdded.addListener(function (device) {
  if (device.vendorId == 6353 && device.productId == 22768) {
    chrome.test.sendMessage('success')
  } else {
    console.error('Got unexpected device: vid:' + device.vendorId +
                  ' pid:' + device.productId)
    chrome.test.sendMessage('failure')
  }
})
chrome.test.sendMessage('loaded')
