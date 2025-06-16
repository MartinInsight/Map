async function loadData() {
  try {
    // 현재 페이지 URL 기반으로 데이터 경로 생성
    const basePath = window.location.pathname.includes('/Map/') ? '/Map' : '';
    const response = await fetch(`${basePath}/data/states-data.json?t=${Date.now()}`);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error("데이터 로드 실패:", error);
    return {
      "CA": { name: "California", inbound: 0, outbound: 0 },
      "NY": { name: "New York", inbound: 0, outbound: 0 }
    };
  }
}

// 사용 예시
document.addEventListener('DOMContentLoaded', async () => {
  const data = await loadData();
  console.log("로드된 데이터:", data);
  // 기존 지도 렌더링 코드...
// 기존 코드 변경
async loadData() {
  try {
    const baseUrl = window.location.href.split('/').slice(0, 3).join('/');
    const [geoJson, metrics] = await Promise.all([
      fetch(`${baseUrl}/data/us-states.json`).then(checkStatus),
      fetch(`${baseUrl}/data/states-data.json`).then(checkStatus)
    ]);
    this.mergeData(await geoJson.json(), await metrics.json());
  } catch (e) {
    console.error("Data load error:", e);
    alert("데이터 로드 실패: " + e.message);
  }
}

function checkStatus(response) {
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  return response;
}
});
