// Copyright 2014 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const startTest = function () {
  const iframe = document.querySelector('iframe')
  const iframeWindow = iframe.contentWindow
  iframe.addEventListener('load', function (e) {
    iframeWindow.document.querySelector('#webview-tag-container').innerHTML =
        '<webview></webview>'
    const webview = iframeWindow.document.querySelector('webview')
    webview.addEventListener('loadstop', function (e) {
      if (!webview.contentWindow) {
        chrome.test.sendMessage('FAILURE')
        return
      }
      chrome.test.sendMessage('LAUNCHED')
    })
    webview.src = 'data:text/html,<body>Guest</body>'
  })
  iframe.src = 'webview.html'
}

window.onload = startTest
