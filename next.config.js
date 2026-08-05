/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // /home/brownjeon/package-lock.json(이 프로젝트와 무관한 홈 디렉토리 파일) 때문에 Next가
  // 워크스페이스 루트를 잘못 추론한다. 이 프로젝트 루트를 명시해 오추론을 제거한다.
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
