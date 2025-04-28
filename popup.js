document.getElementById('open-netflix-btn').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'OPEN_NETFLIX' });
});

document.getElementById('browse-netflix-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.netflix.com/browse' });
});

document.getElementById('continue-watching-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://www.netflix.com/browse/continue-watching' });
});
