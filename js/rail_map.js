class RailCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.markerGroups = new Map(); // { positionKey: { markers: [], center: [lat,lng] }}
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.map);
    this.loadData();
  }

  async loadData() {
    const response = await fetch('data/us-rail.json');
    this.currentData = await response.json();
    this.groupAndRenderMarkers();
    this.map.on('zoomend moveend', () => this.groupAndRenderMarkers());
  }

  groupAndRenderMarkers() {
    // 1. 기존 마커 제거
    this.markerGroups.forEach(group => group.marker?.remove());

    // 2. 50m 이내 겹치는 원 그룹화
    this.markerGroups = this.groupOverlappingMarkers(0.05); 

    // 3. 합쳐진 마커 렌더링
    this.markerGroups.forEach(group => {
      if (group.markers.length > 1) {
        this.renderMergedMarker(group);
      } else {
        this.renderSingleMarker(group.markers[0]);
      }
    });
  }

  groupOverlappingMarkers(kmRadius) {
    const groups = new Map();
    this.currentData.forEach(item => {
      let isGrouped = false;
      for (const [key, group] of groups) {
        if (this.calcDistance(item.lat, item.lng, group.center[0], group.center[1]) <= kmRadius) {
          group.markers.push(item);
          isGrouped = true;
          break;
        }
      }
      if (!isGrouped) {
        groups.set(`${item.lat}_${item.lng}`, { 
          markers: [item], 
          center: [item.lat, item.lng] 
        });
      }
    });
    return groups;
  }

  renderMergedMarker(group) {
    const topLevelMarker = this.getTopLevelMarker(group.markers);
    const marker = L.circleMarker(group.center, {
      radius: 15 + Math.min(group.markers.length, 10), // 최대 25px
      fillColor: this.getColor(topLevelMarker.congestion_level),
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9
    }).bindTooltip(group.markers.length.toString(), { 
      permanent: true, 
      className: 'merged-count', 
      direction: 'center' 
    }).bindPopup(this.createMergedPopup(group.markers));
    marker.addTo(this.map);
    group.marker = marker;
  }

  renderSingleMarker(item) {
    L.circleMarker([item.lat, item.lng], {
      radius: this.getRadiusByIndicator(item.indicator),
      fillColor: this.getColor(item.congestion_level),
      color: "#000",
      weight: 1,
      fillOpacity: 0.8
    }).bindPopup(this.createPopupContent(item)).addTo(this.map);
  }

  createMergedPopup(markers) {
    const sorted = markers.sort((a, b) => 
      this.getLevelValue(b.congestion_level) - this.getLevelValue(a.congestion_level)
    );
    let html = `<div class="merged-popup" style="max-height:200px;overflow-y:auto;">`;
    sorted.forEach(m => {
      html += `
        <div class="merged-item">
          <p><strong>${m.location}</strong> (${m.congestion_level})</p>
          <p>Dwell: ${m.congestion_score.toFixed(1)}h</p>
        </div>
        <hr>
      `;
    });
    html += `</div>`;
    return html;
  }

  getLevelValue(level) {
    const order = { 'Very High':5, 'High':4, 'Average':3, 'Low':2, 'Very Low':1 };
    return order[level];
  }

  getColor(level, isText = false) {
    // 원 색상 (기존보다 약간 연하게)
    const circleColors = {
      'Very High': '#d62828',   // 원: 빨강
      'High': '#f88c2b',        // 원: 주황
      'Average': '#bcbcbc',     // 원: 회색
      'Low': '#5fa9f6',         // 원: 하늘
      'Very Low': '#004fc0'     // 원: 파랑
    };
    
    // 텍스트 색상 (원보다 더 진하게)
    const textColors = {
      'Very High': '#6b1414',   // 텍스트: 빨강
      'High': '#7c4616',        // 텍스트: 주황
      'Average': '#5e5e5e',     // 텍스트: 회색
      'Low': '#30557b',         // 텍스트: 하늘
      'Very Low': '#002860'     // 텍스트: 파랑
    };
  
    return isText ? textColors[level] : circleColors[level];
  }
  
  createPopupContent(data) {
    const level = data.congestion_level || 'Unknown';
    
    return `
      <div class="rail-tooltip">
        <h4>${data.location || 'Unknown Location'}</h4>
        <p><strong>Company:</strong> ${data.company || 'Unknown'}</p>
        <p><strong>Congestion Level:</strong> 
          <span style="color: ${this.getColor(level, true)}"> <!-- 텍스트용 진한 색상 -->
            ${level}
          </span>
        </p>
        <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1) || 'N/A'} hours</p>
      </div>
    `;
  }
}
