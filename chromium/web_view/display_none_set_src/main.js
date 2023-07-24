// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const LOG = function (msg) {
  window.console.log(msg)
}

const failTest = function () {
  chrome.test.sendMessage('WebViewTest.FAILURE')
}

let waitingForLoadstop = false

const startTest = function () {
  const webview = document.createElement('webview')
  webview.style.display = 'none'
  document.body.appendChild(webview)

  const onLoadstop = function (e) {
    if (waitingForLoadstop) {
      chrome.test.sendMessage('WebViewTest.PASSED')
    }
  }
  webview.addEventListener('loadstop', onLoadstop)

  chrome.test.sendMessage('LAUNCHED')
}

window.onAppCommand = function (command) {
  LOG('onAppCommand: ' + command)
  switch (command) {
    case 'navigate-guest':
      window.console.log('navigate-guest command')
      document.querySelector('webview').src =
          'data:text/html,<body>Guest</body>'
      break
    case 'show-guest':
      waitingForLoadstop = true
      document.querySelector('webview').style.display = ''
      break
    case 'hide-guest':
      document.querySelector('webview').style.display = 'none'
      break
    default:
      failTest()
      break
  }
}

window.onload = startTest
