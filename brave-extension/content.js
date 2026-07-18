// Content script: intercept clicks on magnet: links before the browser acts on them.
(function () {
  document.addEventListener(
    'click',
    function (e) {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="magnet:"]') : null
      if (!a) return
      const uri = a.getAttribute('href')
      if (!uri || !/^magnet:\?/i.test(uri)) return
      // Stop the browser from navigating / handing the magnet to the OS default handler.
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()

      // Hand off to the background service worker.
      try {
        chrome.runtime.sendMessage({ type: 'magnet', uri: uri }, function (resp) {
          if (chrome.runtime.lastError) {
            console.error('[ts-ext] sendMessage failed:', chrome.runtime.lastError.message)
          }
        })
      } catch (err) {
        console.error('[ts-ext] sendMessage threw:', err)
      }
    },
    true // capture phase: run before other listeners so preventDefault wins
  )
})()
