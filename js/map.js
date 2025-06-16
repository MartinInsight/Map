async loadData() {
  try {
    // GitHub Pages용 절대 경로 생성
    const repoPath = window.location.pathname.split('/')[1] || 'Map';
    const baseUrl = `${window.location.origin}/${repoPath}`;

    const [geoJson, metrics] = await Promise.all([
      fetch(`${baseUrl}/data/us-states.json`),
      fetch(`${baseUrl}/data/states-data.json?t=${Date.now()}`)
    ]);

    if (!geoJson.ok || !metrics.ok) {
      throw new Error(`HTTP 오류: ${geoJson.status}, ${metrics.status}`);
    }

    this.mergeData(await geoJson.json(), await metrics.json());
  } catch (e) {
    console.error("Data load error:", e);
    // 임시 데이터로 지도 표시
    this.mergeData(
      { features: [] },
      { "CA": { name: "California", inbound: 0, outbound: 0 } }
    );
  }
}
