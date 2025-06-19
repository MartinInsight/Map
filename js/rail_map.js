class RailCongestionMap {
  constructor(mapElementId) {
    this.map = L.map(mapElementId).setView([37.8, -96], 4);
    this.allMarkers = [];
    this.mergedMarkers = [];
    this.currentData = null;
    this.lastUpdated = null;

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(this.map);

    // 지도 이동/줌 변경 시 마커 재계산
    this.map.on('moveend zoomend', () => this.updateMarkers());
    this.loadData();
  }

  async loadData() {
    try {
      const response = await fetch('data/us-rail.json');
      this.currentData = await response.json();
      if (this.currentData.length > 0) {
        this.lastUpdated = this.currentData[0].date;
      }
      this.updateMarkers();
      this.addLastUpdatedText();
    } catch (error) {
      console.error("Failed to load rail data:", error);
    }
  }

  addLastUpdatedText() {
    if (this.lastUpdated) {
      const date = new Date(this.lastUpdated);
      const formattedDate = `${date.getMonth()+1}-${date.getDate()}-${date.getFullYear()}`;
      
      const infoControl = L.control({ position: 'bottomleft' });
      
      infoControl.onAdd = () => {
        const div = L.DomUtil.create('div', 'last-updated-info');
        div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
        div.style.backgroundColor = 'white';
        div.style.padding = '5px 10px';
        div.style.borderRadius = '5px';
        div.style.boxShadow = '0 0 5px rgba(0,0,0,0.2)';
        return div;
      };
      
      infoControl.addTo(this.map);
    }
  }

  updateMarkers() {
    // 기존 마커 제거
    this.clearMarkers();

    // 현재 뷰포트 내 마커만 필터링
    const bounds = this.map.getBounds();
    const visibleMarkers = this.currentData.filter(item => 
      bounds.contains([item.lat, item.lng])
    );

    // 겹치는 마커 그룹화 (10km 이내)
    const markerGroups = this.groupMarkers(visibleMarkers, 10);

    // 마커 렌더링
    markerGroups.forEach(group => {
      if (group.markers.length > 1) {
        this.createMergedMarker(group);
      } else {
        this.createSingleMarker(group.markers[0]);
      }
    });
  }

  groupMarkers(markers, thresholdKm) {
    const groups = [];
    const processed = new Set();

    markers.forEach((marker, index) => {
      if (processed.has(index)) return;

      const group = {
        markers: [marker],
        center: [marker.lat, marker.lng],
        topLevel: marker
      };

      // 현재 마커와 가까운 마커 찾기
      for (let i = index + 1; i < markers.length; i++) {
        const distance = this.calcDistance(
          marker.lat, marker.lng,
          markers[i].lat, markers[i].lng
        );
        
        if (distance <= thresholdKm) {
          group.markers.push(markers[i]);
          processed.add(i);
          
          // 최고 등급 마커 업데이트
          if (this.getLevelValue(markers[i].congestion_level) > 
              this.getLevelValue(group.topLevel.congestion_level)) {
            group.topLevel = markers[i];
          }
        }
      }

      groups.push(group);
    });

    return groups;
  }

  createMergedMarker(group) {
    // 평균 좌표 계산
    const center = group.markers.reduce((acc, marker) => {
      acc.lat += marker.lat;
      acc.lng += marker.lng;
      return acc;
    }, { lat: 0, lng: 0 });
    
    center.lat /= group.markers.length;
    center.lng /= group.markers.length;

    const marker = L.circleMarker([center.lat, center.lng], {
      radius: 15 + Math.min(group.markers.length, 10), // 최대 25px
      fillColor: this.getColor(group.topLevel.congestion_level),
      color: "#fff",
      weight: 2,
      fillOpacity: 0.9
    });

    // 가운데 흰색 숫자 표시
    marker.bindTooltip(group.markers.length.toString(), {
      permanent: true,
      className: 'merged-marker-count',
      direction: 'center'
    });

    // 확장된 툴팁
    marker.bindPopup(this.createMergedPopup(group.markers));
    marker.addTo(this.map);
    this.mergedMarkers.push(marker);
  }

  createSingleMarker(markerData) {
    const marker = L.circleMarker([markerData.lat, markerData.lng], {
      radius: this.getRadiusByIndicator(markerData.indicator),
      fillColor: this.getColor(markerData.congestion_level),
      color: "#000",
      weight: 1,
      fillOpacity: 0.8
    });
    marker.bindPopup(this.createPopupContent(markerData));
    marker.addTo(this.map);
    this.allMarkers.push(marker);
  }

  createMergedPopup(markers) {
    // 등급별 정렬 (높은 등급이 위로)
    const sorted = [...markers].sort((a, b) => 
      this.getLevelValue(b.congestion_level) - this.getLevelValue(a.congestion_level)
    );

    let html = `
      <div class="merged-popup" style="max-height:300px;overflow-y:auto;">
        <h3>${markers.length} Merged Locations</h3>
    `;

    sorted.forEach(marker => {
      html += `
        <div class="merged-item">
          <h4>${marker.location}</h4>
          <p><strong>Level:</strong> 
            <span style="color:${this.getColor(marker.congestion_level, true)}">
              ${marker.congestion_level}
            </span>
          </p>
          <p><strong>Dwell Time:</strong> ${marker.congestion_score?.toFixed(1)}h</p>
          <hr>
        </div>
      `;
    });

    html += `</div>`;
    return html;
  }

  clearMarkers() {
    this.allMarkers.forEach(marker => this.map.removeLayer(marker));
    this.mergedMarkers.forEach(marker => this.map.removeLayer(marker));
    this.allMarkers = [];
    this.mergedMarkers = [];
  }

  calcDistance(lat1, lng1, lat2, lng2) {
    // Haversine 공식으로 거리 계산 (km)
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * 
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  getLevelValue(level) {
    const order = { 
      'Very High': 5, 'High': 4, 'Average': 3, 'Low': 2, 'Very Low': 1 
    };
    return order[level] || 0;
  }

  getRadiusByIndicator(indicator) {
    if (indicator > 2) return 20;
    if (indicator > 1) return 16;
    if (indicator > -1) return 12;
    if (indicator > -2) return 8;
    return 5;
  }

  getColor(level, isText = false) {
    const circleColors = {
      'Very High': '#d62828', 'High': '#f88c2b',
      'Average': '#bcbcbc', 'Low': '#5fa9f6', 
      'Very Low': '#004fc0'
    };
    const textColors = {
      'Very High': '#6b1414', 'High': '#7c4616',
      'Average': '#5e5e5e', 'Low': '#30557b',
      'Very Low': '#002860'
    };
    return isText ? textColors[level] : circleColors[level];
  }

  createPopupContent(data) {
    const level = data.congestion_level || 'Unknown';
    return `
      <div class="rail-tooltip">
        <h4>${data.location}</h4>
        <p><strong>Level:</strong> 
          <span style="color:${this.getColor(level, true)}">
            ${level}
          </span>
        </p>
        <p><strong>Dwell Time:</strong> ${data.congestion_score?.toFixed(1)}h</p>
      </div>
    `;
  }
}
