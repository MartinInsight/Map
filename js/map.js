async function loadData() {
  const repoName = window.location.pathname.split('/')[1];
  const dataUrl = `/${repoName}/data/states-data.json?t=${new Date().getTime()}`;

  try {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    console.log("데이터 로드 성공:", Object.keys(data).length + "개 주");
    return data;
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
  // 지도 렌더링 코드...
});
