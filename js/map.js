async function loadData() {
  const repoName = window.location.pathname.split('/')[1] || 'Map';
  const dataUrl = `https://${window.location.hostname}/${repoName}/data/states-data.json?_=${Date.now()}`;

  try {
    const res = await fetch(dataUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    console.error("데이터 로드 실패:", error);
    return {
      "CA": { name: "California", inbound: 0, outbound: 0 }, // 임시 데이터
      "NY": { name: "New York", inbound: 0, outbound: 0 }
    };
  }
}

// 사용 예시
loadData().then(data => {
  console.log("로드된 데이터:", data);
  // 지도 렌더링 코드
});
