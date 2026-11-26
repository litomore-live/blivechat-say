import assert from 'node:assert/strict';
import test from 'node:test';
import {createVoiceCatalog, detectLanguage} from '../src/voice-selection.js';

test('detects short chat messages offline and preserves the configured voice for the same language', () => {
  const catalog = createVoiceCatalog([
    {name: 'Siri 中文', identifier: 'siri-id', aliases: ['中文'], languageCode: 'yue_HK'},
    {name: '日本語', languageCode: 'ja_JP', identifier: 'ja-id'},
    {name: '한국어', culture: 'ko-KR'},
  ]);
  for (const preferred of ['Siri 中文', 'siri-id', '中文']) {
    assert.equal(catalog.select(preferred, detectLanguage('你好')), preferred);
    assert.equal(catalog.select(preferred, detectLanguage('こんにちは')), 'ja-id');
    assert.equal(catalog.select(preferred, detectLanguage('안녕하세요')), '한국어');
    assert.equal(catalog.select(preferred, detectLanguage('🎉')), preferred);
    assert.equal(catalog.select(preferred, 'fr'), preferred);
  }
});

test('reads simplified and traditional Chinese in the selected Taiwanese or Cantonese voice', () => {
  const regionalVoices = [
    {name: 'Meijia (Chinese (Taiwan))', languageCode: 'zh_TW'},
    {name: 'Sinji (Chinese (Hong Kong))', languageCode: 'zh_HK'},
    {name: 'Siri Voice 2 (yue-HK)', languageCode: 'yue_HK'},
  ];
  const catalog = createVoiceCatalog([{name: 'Mandarin', languageCode: 'zh_CN', quality: 'premium'}, ...regionalVoices]);
  for (const text of ['欢迎来到直播间', '歡迎來到直播間']) {
    const code = detectLanguage(text);
    assert.equal(code, 'zh');
    for (const voice of regionalVoices) assert.equal(catalog.select(voice.name, code), voice.name);
  }
});

test('tries later detectors for English and only selects fallbacks within the four supported languages', () => {
  const catalog = createVoiceCatalog([
    {name: '中文', languageCode: 'zh_CN'}, {name: 'English', culture: 'en-US'}, {name: 'French', culture: 'fr-FR'},
  ]);
  assert.equal(catalog.select('中文', detectLanguage('hello world')), 'English');
  assert.equal(detectLanguage('Bonjour tout le monde'), 'fr');
  assert.equal(catalog.select('English', 'fr-FR', '中文'), '中文');
  assert.equal(catalog.select('French', 'en'), 'English');
});

test('prefers an exact locale, then quality, Siri and the highest Siri number within a language', () => {
  const voices = [
    {name: '中文', languageCode: 'zh_CN'},
    {name: 'Disabled', culture: 'en-US', quality: 'premium', enabled: false},
    {name: 'Dialect', languageCode: 'en-scotland', quality: 'premium'},
    {name: 'GB', languageCode: 'en_GB'},
    {name: 'US', languageCode: 'en_US', quality: 'enhanced'},
    {name: 'Siri Voice 2 (en-US)', identifier: 'two', languageCode: 'en_US', isSiri: true, quality: 'enhanced'},
    {name: 'Siri Voice 4 (en-US)', identifier: 'four', languageCode: 'en_US', isSiri: true, quality: 'enhanced'},
  ];
  const catalog = createVoiceCatalog(voices);
  assert.equal(catalog.select('中文', 'EN-gb'), 'GB');
  assert.equal(catalog.select('中文', 'en_AU'), 'four');
  assert.equal(catalog.select('中文', 'en-US'), 'four');
  assert.equal(catalog.select('Dialect', 'en'), 'Dialect');
  assert.equal(catalog.has('Disabled'), false);
  const premium = createVoiceCatalog([...voices, {name: 'Premium', languageCode: 'en_US', quality: 'premium'}]);
  assert.equal(premium.select('中文', 'en'), 'Premium');
});

test('normalizes macOS Chinese locale variants and keeps explicit dialect choices', () => {
  const catalog = createVoiceCatalog([
    {name: 'English', culture: 'en-US'},
    {name: 'Cantonese', languageCode: 'zh_Hant_HK', quality: 'premium'},
    {name: 'Sichuan', languageCode: 'zh_CN_U_SD@sd=cnsc', quality: 'premium'},
    {name: 'Mandarin', languageCode: 'zh_CN'},
  ]);
  for (const code of ['zh', 'yue-HK', 'zh-Hant-MO', 'zh-CN-u-sd-cnsc']) {
    assert.equal(catalog.select('English', code), 'Mandarin');
    assert.equal(catalog.select('Cantonese', code), 'Cantonese');
    assert.equal(catalog.select('Sichuan', code), 'Sichuan');
  }
});
