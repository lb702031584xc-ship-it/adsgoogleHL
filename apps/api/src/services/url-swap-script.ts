/** 生成可贴到 Google Ads Scripts 的自动换链脚本（对标 AutoAds）。 */
export function buildUrlSwapAdsScript(input: {
  apiBaseUrl: string;
  apiAuthCode: string;
}): string {
  const endpoint = `${input.apiBaseUrl.replace(/\/$/, "")}/api/v1/url-swap/gettemplate`;
  const base = `${endpoint}?apiauthcode=${encodeURIComponent(input.apiAuthCode)}&campaign_name=`;

  return `// AdLinkLab Google Ads 自动跟踪模板脚本
// 服务器: ${input.apiBaseUrl.replace(/\/$/, "")}

var API_BASE_URL = '${base}';

function main() {
  if (isMccAccount()) {
    var accountIterator = MccApp
      .accounts()
      .withCondition('CanManageClients = FALSE')
      .get();

    while (accountIterator.hasNext()) {
      var account = accountIterator.next();
      MccApp.select(account);
      processAccount();
    }
  } else {
    processAccount();
  }
}

function isMccAccount() {
  try {
    var accIter = MccApp.accounts().get();
    return accIter.hasNext();
  } catch (e) {
    return false;
  }
}

function processAccount() {
  var campaignIterator = AdsApp
    .campaigns()
    .withCondition('Status = ENABLED')
    .get();

  while (campaignIterator.hasNext()) {
    var campaign = campaignIterator.next();
    var campaignName = campaign.getName();
    Logger.log('处理广告系列: ' + campaignName);

    var apiUrl = API_BASE_URL + encodeURIComponent(campaignName);
    var response = fetchWithRetries(apiUrl, 3);

    if (response) {
      var trackingTemplate = response.trim();
      if (trackingTemplate) {
        campaign.urls().setTrackingTemplate(trackingTemplate);
        Logger.log('成功设置: ' + campaignName);
      } else {
        Logger.log('返回空模板: ' + campaignName);
      }
    } else {
      Logger.log('获取失败: ' + campaignName);
    }
  }
}

function fetchWithRetries(url, maxRetries) {
  for (var i = 1; i <= maxRetries; i++) {
    try {
      var response = UrlFetchApp.fetch(url, {
        muteHttpExceptions: true,
        followRedirects: true
      });

      var code = response.getResponseCode();

      if (code == 200) {
        return response.getContentText();
      }

      Logger.log('请求失败 (尝试' + i + '/' + maxRetries + '): HTTP ' + code);
    } catch (e) {
      Logger.log('请求异常 (尝试' + i + '/' + maxRetries + '): ' + e);
    }

    if (i < maxRetries) {
      Utilities.sleep(2000);
    }
  }
  return null;
}
`;
}
