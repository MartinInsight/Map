async loadData() {
  try {
    // 경로 생성 로직 간소화
    const baseUrl = window.location.origin + (window.location.pathname.includes('/Map') ? '/Map' : '');

    const [geoJsonResp, metricsResp] = await Promise.all([
      fetch(`${baseUrl}/data/us-states.json`),
      fetch(`${baseUrl}/data/states-data.json?t=${Date.now()}`)
    ]);

    if (!geoJsonResp.ok || !metricsResp.ok) {
      throw new Error(`Data loading failed: ${geoJsonResp.status}, ${metricsResp.status}`);
    }

    const [geoJson, metrics] = await Promise.all([
      geoJsonResp.json(),
      metricsResp.json()
    ]);

    // GeoJSON 속성에 state_code 매핑
    geoJson.features.forEach(feature => {
      feature.properties.state_code = feature.properties.code || feature.id;
    });

    // 지도에 데이터 렌더링
    this.renderMap(geoJson, metrics);
    
  } catch (e) {
    console.error("Data load error:", e);
    this.showErrorMap();
  }
}

renderMap(geoJson, metrics) {
  if (this.stateLayer) {
    this.map.removeLayer(this.stateLayer);
  }

  this.stateLayer = L.geoJSON(geoJson, {
    style: (feature) => {
      const stateCode = feature.properties.state_code;
      const data = metrics[stateCode] || {};
      const value = data.inbound || 0;
      
      // 색상 그래디언트 설정
      const color = value > 0 ? '#008000' :  // 양수: 녹색
                    value < 0 ? '#FF0000' :  // 음수: 빨강
                    '#CCCCCC';               // 0: 회색

      return {
        fillColor: color,
        weight: 2,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.7
      };
    },
    onEachFeature: (feature, layer) => {
      const stateCode = feature.properties.state_code;
      const data = metrics[stateCode] || {};
      
      layer.bindPopup(`
        <h4>${data.name || feature.properties.name}</h4>
        <p>Inbound: ${data.inbound || 'N/A'}</p>
        <p>Outbound: ${data.outbound || 'N/A'}</p>
      `);
    }
  }).addTo(this.map);
}
