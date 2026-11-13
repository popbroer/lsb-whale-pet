'use strict';

/**
 * 给打包好的 exe 写入图标与版本信息（纯 JS，不依赖 rcedit）。
 * 用法：node scripts/patch-exe.js "E:/WhalePet/鲸鱼娘/鲸鱼娘.exe"
 */

const fs = require('fs');
const path = require('path');
let resedit;
try {
  resedit = require('resedit');
} catch (_) {
  console.error('需要 resedit：npm i -D resedit');
  process.exit(1);
}

const { NtExecutable, NtExecutableResource, Resource, Data } = resedit;

const exePath = process.argv[2];
const icoPath = process.argv[3] || path.join(__dirname, '..', 'assets', 'icon.ico');

if (!exePath || !fs.existsSync(exePath)) {
  console.error('找不到 exe:', exePath);
  process.exit(1);
}

const exe = NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const res = NtExecutableResource.from(exe);

// 1) 图标
if (fs.existsSync(icoPath)) {
  const iconFile = Data.IconFile.from(fs.readFileSync(icoPath));
  const groups = Resource.IconGroupEntry.fromEntries(res.entries);
  const lang = groups.length ? groups[0].lang : 1033;
  const id = groups.length ? groups[0].id : 1;
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    id,
    lang,
    iconFile.icons.map((i) => i.data)
  );
  console.log('icon ok');
}

// 2) 版本信息
const versions = Resource.VersionInfo.fromEntries(res.entries);
if (versions.length) {
  const vi = versions[0];
  vi.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      ProductName: '鲸鱼娘',
      FileDescription: '鲸鱼娘 · cc-switch 桌面宠物',
      CompanyName: 'deepseek-whale-pet',
      LegalCopyright: 'Fan work. Character art CC BY-NC-SA 4.0',
      OriginalFilename: '鲸鱼娘.exe',
      InternalName: 'whale-pet',
      FileVersion: '0.4.0',
      ProductVersion: '0.4.0',
    }
  );
  vi.outputToResourceEntries(res.entries);
  console.log('version ok');
}

res.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));
console.log('patched:', exePath);
