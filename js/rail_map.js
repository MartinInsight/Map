class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        // L.markerClusterGroup 초기화 시 iconCreateFunction 옵션 추가
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, // 기존 설정 유지 또는 필요에 따라 조정
            disableClusteringAtZoom: 9, // 기존 설정 유지 또는 필요에 따라 조정
            
            // --- 여기가 가장 중요한 변경 사항입니다! ---
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevel = -1; // 혼잡도를 숫자로 매핑하여 가장 높은 값 찾기
                let dominantColor = this.getColor('Average'); // 기본값은 'Average' 색상

                // 혼잡도 레벨을 숫자로 매핑하는 함수 (예: Very High가 가장 높은 값)
                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0; // 'Average' 또는 'Unknown'
                    }
                };

                // 클러스터 내 모든 마커를 순회하며 가장 높은 혼잡도 레벨 찾기
                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData; // 마커 생성 시 저장했던 itemData 활용
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevel) {
                            highestCongestionLevel = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level); // 해당 혼잡도에 맞는 색상
                        }
                    }
                });

                // 클러스터 아이콘의 HTML 및 스타일 생성
                const childCount = cluster.getChildCount();
                const size = 40 + Math.min(childCount * 0.5, 20); // 클러스터 크기를 마커 개수에 따라 동적으로 조절
                
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom', // 커스텀 클래스 (CSS에서 추가 스타일링 가능)
                    iconSize: new L.Point(size, size)
                });
            }
        });
        this.currentData = null;
        this.lastUpdated = null;
        this.filterControlInstance = null;
        this.errorControl = null;
        this.lastUpdatedControl = null;

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        // 줌 변경 핸들러는 이제 필요하지 않습니다. Leaflet.markercluster가 줌에 따라 자동으로 클러스터링을 처리합니다.
        // this.map.on('zoomend', () => {
        //     this.handleZoomChange();
        // });

        this.loadData();
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            this.currentData = rawData.map(item => ({
                ...item,
                lat: item.lat || item.Latitude,
                lng: item.lng || item.Longitude,
                Yard: item.location || 'Unknown' // 'Yard' 필드 통일
            })).filter(item => item.lat && item.lng && item.Yard);

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers(); // 초기 마커 렌더링
            this.addLastUpdatedText();
            this.addRightControls();
        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }

    // 마커 렌더링 로직 (Leaflet.markercluster 사용)
    renderMarkers(data = this.currentData) {
        this.allMarkers.clearLayers(); // 기존 모든 마커 및 클러스터 제거

        data.forEach(item => {
            const marker = L.circleMarker([item.lat, item.lng], {
                radius: this.getRadiusByIndicator(item.indicator),
                fillColor: this.getColor(item.congestion_level),
                color: "#000",
                weight: 1,
                opacity: 1,
                fillOpacity: 0.8
            });

            // 마커 이벤트 설정 (호버 시 팝업, 클릭 시 줌인)
            marker.on({
                mouseover: (e) => {
                    // 호버 시 팝업
                    const popup = L.popup({
                        closeButton: false,
                        autoClose: true,
                        closeOnClick: false, // 호버 시 팝업은 클릭으로 닫히지 않도록
                        maxHeight: 300,
                        maxWidth: 300
                    })
                    .setLatLng(e.latlng)
                    .setContent(this.createPopupContent([item])) // 단일 아이템 배열로 전달
                    .openOn(this.map);
                },
                mouseout: () => {
                    this.map.closePopup();
                },
                // 클릭 시 줌 인은 Leaflet.markercluster가 기본적으로 처리하므로,
                // 여기서는 개별 마커에 대한 별도의 줌 인 로직은 필요 없습니다.
                // 다만, 팝업을 닫고 싶다면 추가할 수 있습니다.
                click: () => {
                    this.map.closePopup(); // 클릭 시 열려있던 호버 팝업 닫기
                    // 클러스터 클릭 시 자동 줌인되므로, 개별 마커 클릭 시에는 줌인하지 않습니다.
                }
            });

            this.allMarkers.addLayer(marker); // 마커를 클러스터 그룹에 추가
        });

        this.map.addLayer(this.allMarkers); // 클러스터 그룹을 지도에 추가

        // Leaflet.markercluster의 클러스터 클릭 이벤트를 커스텀하여 줌인만 하도록 설정
        this.allMarkers.on('clusterclick', (a) => {
            a.layer.zoomToBounds(); // 클러스터 클릭 시 해당 클러스터 범위로 줌인
            this.map.closePopup(); // 혹시 열려있을 팝업 닫기
        });

        // Leaflet.markercluster의 클러스터 호버 이벤트를 사용하여 팝업 표시
        this.allMarkers.on('clustermouseover', (a) => {
            const clusterItems = a.layer.getAllChildMarkers().map(m => m.options.itemData);
            const popup = L.popup({
                closeButton: false,
                autoClose: true,
                closeOnClick: false,
                maxHeight: 300,
                maxWidth: 300
            })
            .setLatLng(a.latlng)
            .setContent(this.createPopupContent(clusterItems)) // 클러스터 아이템들로 팝업 생성
            .openOn(this.map);
        });

        this.allMarkers.on('clustermouseout', () => {
            this.map.closePopup();
        });
    }

    // 마커 생성 시 itemData를 options에 추가 (팝업 내용을 위해)
    createSingleMarker(item) {
        const marker = L.circleMarker([item.lat, item.lng], {
            radius: this.getRadiusByIndicator(item.indicator),
            fillColor: this.getColor(item.congestion_level),
            color: "#000",
            weight: 1,
            opacity: 1,
            fillOpacity: 0.8,
            itemData: item // 중요: 팝업 내용을 위해 원본 데이터를 마커 옵션에 저장
        });
        return marker; // 마커를 직접 반환하여 클러스터 그룹에 추가하도록 합니다.
    }

    // groupMarkersByLocation, createClusterMarker 메서드는 더 이상 필요 없습니다.
    // clearAllMarkers 메서드는 allMarkers.clearLayers()로 대체됩니다.
    // handleZoomChange도 더 이상 필요 없습니다.

    // 팝업 내용 생성 (다중 마커 지원)
    createPopupContent(items) {
        // Ensure 'items' is always an array, even if a single item is passed
        const safeItems = Array.isArray(items) ? items : [items]; 
        const isMultiple = safeItems.length > 1;
        let content = '';
    
        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                            <h4>${safeItems.length} Locations</h4>
                            <p>Showing clustered locations:</p>
                         </div>
                         <div class="cluster-popup-content">`;
        }
    
        // Safely iterate through each item
        safeItems.forEach(item => {
            // Add a check: if item is undefined, null, or doesn't have required properties, skip it or provide defaults.
            if (!item || !item.lat || !item.lng || !item.Yard) {
                console.warn("Skipping invalid item in popup content:", item);
                return; // Skip this iteration if the item is invalid
            }
    
            // Now it's safe to access item.congestion_level
            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const congestionScore = item.congestion_score?.toFixed(1) || 'N/A'; // Use optional chaining for safety
    
            content += `
                <div class="location-info">
                    <h5>${location}</h5>
                    <p><strong>Company:</strong> ${company}</p>
                    <p><strong>Congestion Level:</strong>
                        <span style="color: ${this.getColor(level, true)}">
                            ${level}
                        </span>
                    </p>
                    <p><strong>Dwell Time:</strong> ${congestionScore} hours</p>
                </div>
                ${isMultiple && safeItems.indexOf(item) !== safeItems.length - 1 ? '<hr>' : ''}
            `;
        });
    
        if (isMultiple) {
            content += '</div>';
        }
    
        return content || '<p>No valid data to display for this location.</p>'; // Fallback if no valid items
    }

    addLastUpdatedText() {
        if (this.lastUpdatedControl) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        if (this.lastUpdated) {
            const date = new Date(this.lastUpdated);
            const formattedDate = date.toLocaleString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
                hour12: false
            });

            const infoControl = L.control({ position: 'bottomleft' });

            infoControl.onAdd = () => {
                const div = L.DomUtil.create('div', 'last-updated-info');
                div.innerHTML = `<strong>Last Updated:</strong> ${formattedDate}`;
                return div;
            };

            infoControl.addTo(this.map);
            this.lastUpdatedControl = infoControl;
        }
    }

    // 필터링 로직: 야드를 선택하더라도 다른 마커들 여전히 보여줌
    addRightControls() {
        if (this.filterControlInstance) {
            this.map.removeControl(this.filterControlInstance);
        }

        const control = L.control({ position: 'topright' });

        control.onAdd = () => {
            const div = L.DomUtil.create('div', 'map-control-group-right');

            const validYards = this.currentData
                .filter(item => item.Yard && item.Yard.trim() !== '')
                .map(item => item.Yard);

            const yards = [...new Set(validYards)].sort((a, b) => a.localeCompare(b));

            const filterDropdownHtml = `
                <select class="yard-filter">
                    <option value="">Select Yard</option>
                    ${yards.map(yard =>
                        `<option value="${yard}">${yard}</option>`
                    ).join('')}
                </select>
            `;
            div.insertAdjacentHTML('beforeend', filterDropdownHtml);

            const resetButtonHtml = `
                <button class="rail-reset-btn reset-btn">Reset View</button>
            `;
            div.insertAdjacentHTML('beforeend', resetButtonHtml);

            div.querySelector('.yard-filter').addEventListener('change', (e) => {
                const yardName = e.target.value;
                if (!yardName) {
                    this.map.setView([37.8, -96], 4);
                    // 필터를 해제하면 모든 마커를 다시 표시합니다. (renderMarkers는 이미 this.currentData를 기본으로 사용)
                    // this.renderMarkers(this.currentData); // 이 줄은 필요 없음 (이미 기본값)
                    return;
                }

                const yardData = this.currentData.filter(item => item.Yard === yardName);
                if (yardData.length > 0) {
                    const center = this.getYardCenter(yardData);
                    this.map.setView(center, 8); // 선택된 야드 중심으로 이동 및 줌인
                    // renderMarkers(this.currentData)를 호출하여 모든 마커를 여전히 표시합니다.
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                this.map.setView([37.8, -96], 4);
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) yardFilter.value = '';
                // renderMarkers(this.currentData)를 호출하여 모든 마커를 다시 표시합니다.
                // this.renderMarkers(this.currentData); // 이 줄은 필요 없음 (이미 기본값)
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    getYardCenter(yardData) {
        if (!yardData || yardData.length === 0) return [37.8, -96];

        const lats = yardData.map(item => item.lat);
        const lngs = yardData.map(item => item.lng);

        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        return [
            (minLat + maxLat) / 2,
            (minLng + maxLng) / 2
        ];
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
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e'
        };

        return isText ? textColors[level] : circleColors[level];
    }

    displayErrorMessage(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }

        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function() {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = message;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;
    }
}

window.RailCongestionMap = RailCongestionMap;
