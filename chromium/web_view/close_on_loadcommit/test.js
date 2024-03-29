// Copyright 2013 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
let createCount = 0

const launchWindow = function () {
  chrome.app.window.create('main.html', {}, function (win) {
    if (createCount == 0) { chrome.test.sendMessage('LAUNCHED') }
    if (createCount < 3) {
      ++createCount
      chrome.test.log('Attempt no #' + createCount)
      win.close()
      launchWindow()
    } else {
      chrome.test.sendMessage('done-close-on-loadcommit')
    }
  })
}

chrome.app.runtime.onLaunched.addListener(function () {
  launchWindow()
})
