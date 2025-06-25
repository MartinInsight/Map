class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);

        // L.markerClusterGroup 초기화 시 iconCreateFunction 옵션 사용
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, // 필요에 따라 조정
            disableClusteringAtZoom: 9, // 필요에 따라 조정
            
            // 클러스터 아이콘 생성 함수 (가장 혼잡한 마커의 색상 반영)
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1; // 혼잡도 값을 숫자로 변환하여 비교
                let dominantColor = this.getColor('Average'); // 기본값은 'Average' 색상

                // 혼잡도 레벨을 숫자로 매핑하는 함수 (가장 높은 혼잡도에 가장 큰 값)
                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0; // 'Average', 'Unknown' 등
                    }
                };

                // 클러스터 내 모든 마커를 순회하며 가장 높은 혼잡도 레벨 찾기
                childMarkers.forEach(marker => {
                    // Python 스크립트에서 이미 유효성 검사를 거치므로, 여기서는 데이터 존재 여부만 확인
                    const itemData = marker.options.itemData; 
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level); // 해당 혼잡도에 맞는 색상
                        }
                    }
                });

                // 클러스터 아이콘의 HTML 및 스타일 생성
                const childCount = cluster.getChildCount();
                const size = 30 + Math.min(childCount * 0.5, 30); 
                
                return new L.DivIcon({
                    html: `<div style="background-color: ${dominantColor}; width: ${size}px; height: ${size}px; line-height: ${size}px; border-radius: 50%; color: white; font-weight: bold; text-align: center; display: flex; align-items: center; justify-content: center;"><span>${childCount}</span></div>`,
                    className: 'marker-cluster-custom',
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

        this.addRightControls(); // 오른쪽 컨트롤 추가 (필터, 리셋)
        this.addLastUpdatedText(); // 마지막 업데이트 텍스트 추가

        // 데이터를 로드하고 맵이 활성화되면 마커를 렌더링합니다.
        // 이 부분은 HTML의 메인 스크립트에서 호출되므로 여기서 직접 호출하지 않습니다.
        // this.loadData(); 
    }

    async loadData() {
        console.log("Attempting to load rail data...");
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const rawData = await response.json();
            console.log("Raw data loaded:", rawData.length, "items");

            // --- 이 부분을 변경합니다! ---
            // Python 스크립트에서 이미 데이터를 정제했으므로,
            // JavaScript에서는 필수 필드에 대한 최소한의 유효성 검사만 수행합니다.
            // 특히 위경도 숫자가 유효한지 확인하는 것이 중요합니다.
            this.currentData = rawData.filter(item => {
                const isValid = item.lat && item.lng && !isNaN(item.lat) && !isNaN(item.lng) && item.location && item.congestion_level;
                if (!isValid) {
                    console.warn("Skipping item due to invalid or missing data (lat, lng, location, congestion_level):", item);
                }
                return isValid;
            });
            // 만약 위 필터링이 너무 엄격하다고 생각되면, 단순히 this.currentData = rawData; 로 변경해보세요.
            // 또는 최소한의 필터링만 남겨둡니다 (예: 위경도 유효성만).
            // this.currentData = rawData.filter(item => !isNaN(item.lat) && !isNaN(item.lng));
            
            console.log("Filtered data for rendering:", this.currentData.length, "items");


            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date; 
                this.updateLastUpdatedText(this.lastUpdated); 
            } else {
                this.updateLastUpdatedText('No data available or all filtered out.');
                this.displayErrorMessage("No valid rail data found to display.");
            }

            this.renderMarkers(); // 필터링된 데이터로 마커 렌더링

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
            this.updateLastUpdatedText('Error loading data');
        }
    }

    // 마커 렌더링
    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty.");
            this.allMarkers.clearLayers(); // 기존 마커 모두 제거
            this.map.removeLayer(this.allMarkers); // 맵에서 클러스터 그룹 제거
            return; 
        }

        this.allMarkers.clearLayers();

        data.forEach(item => {
            const marker = this.createSingleMarker(item);
            this.allMarkers.addLayer(marker);
        });

        if (!this.map.hasLayer(this.allMarkers)) {
            this.map.addLayer(this.allMarkers); 
        }
        
        this.allMarkers.off('clusterclick'); // 기존 리스너 제거 (중복 방지)
        this.allMarkers.on('clusterclick', (a) => {
            a.layer.zoomToBounds();
            this.map.closePopup();
        });

        this.allMarkers.off('clustermouseover'); // 기존 리스너 제거
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
            .setContent(this.createPopupContent(clusterItems))
            .openOn(this.map);
        });

        this.allMarkers.off('clustermouseout'); // 기존 리스너 제거
        this.allMarkers.on('clustermouseout', () => {
            this.map.closePopup();
        });
        console.log("Markers rendered:", data.length);
    }

    // 개별 마커 생성 (이전과 동일)
    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);

        const iconHtml = `
            <div style="background-color: ${color}; width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid white; box-shadow: 0 0 3px rgba(0,0,0,0.5);"></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [15, 15],
            iconAnchor: [7.5, 7.5]
        });

        const marker = L.marker([item.lat, item.lng], { icon: customIcon, itemData: item });

        marker.on('click', () => {
            marker.bindPopup(this.createPopupContent(item)).openPopup();
        });

        return marker;
    }

    // 팝업 콘텐츠 생성 (이전과 동일)
    createPopupContent(items) {
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

        safeItems.forEach(item => {
            if (!item || typeof item !== 'object' || !item.location || !item.congestion_level || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item for popup content:", item);
                return;
            }

            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const congestionScore = item.congestion_score !== null && !isNaN(item.congestion_score) ? item.congestion_score.toFixed(1) : 'N/A';

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

        return content || '<p>No valid rail congestion data to display for this location.</p>';
    }

    // 색상 반환 (이전과 동일)
    getColor(level, isText = false) {
        const circleColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#5fa9f6',
            'Very Low': '#004fc0',
            'Average': '#bcbcbc',
            'Unknown': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#d62828',
            'High': '#f88c2b',
            'Low': '#004fc0',
            'Very Low': '#004fc0',
            'Average': '#555555',
            'Unknown': '#555555'
        };

        return isText ? textColors[level] : circleColors[level];
    }

    // 오른쪽 컨트롤 추가 (이전과 동일)
    addRightControls() {
        if (this.filterControlInstance && this.map.hasControl(this.filterControlInstance)) {
            this.map.removeControl(this.filterControlInstance);
        }

        const CongestionFilterControl = L.Control.extend({
            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'map-control-group-right');
                L.DomEvent.disableClickPropagation(container);

                const selectBox = L.DomUtil.create('select', 'filter-control select', container);
                const options = ['All', 'Very High', 'High', 'Low', 'Very Low', 'Average'];
                options.forEach(optionText => {
                    const option = L.DomUtil.create('option', '', selectBox);
                    option.value = optionText;
                    option.textContent = optionText === 'All' ? 'Filter by Congestion' : optionText;
                    if (optionText === 'All') {
                        option.selected = true;
                        option.disabled = true;
                        option.hidden = true;
                    }
                });

                L.DomEvent.on(selectBox, 'change', (e) => {
                    const selectedLevel = e.target.value;
                    this._mapInstance.filterByCongestion(selectedLevel);
                }, this);

                const resetButton = L.DomUtil.create('button', 'reset-btn', container);
                resetButton.textContent = 'Reset View';
                L.DomEvent.on(resetButton, 'click', () => {
                    this._mapInstance.resetMap();
                }, this);

                return container;
            },
            onRemove: function(map) { /* Nothing to do */ }
        });

        this.filterControlInstance = new CongestionFilterControl({ position: 'topright' });
        this.filterControlInstance._mapInstance = this;
        this.filterControlInstance.addTo(this.map);
    }

    // 마지막 업데이트 텍스트 컨트롤 추가 (이전과 동일)
    addLastUpdatedText() {
        if (this.lastUpdatedControl && this.map.hasControl(this.lastUpdatedControl)) {
            this.map.removeControl(this.lastUpdatedControl);
        }

        const LastUpdatedControl = L.Control.extend({
            onAdd: function(map) {
                this._div = L.DomUtil.create('div', 'last-updated-info');
                this.update('');
                return this._div;
            },
            update: function(text) {
                this._div.innerHTML = `Last Updated: <strong>${text}</strong>`;
            }
        });

        this.lastUpdatedControl = new LastUpdatedControl({ position: 'bottomleft' });
        this.lastUpdatedControl.addTo(this.map);
        this.updateLastUpdatedText(this.lastUpdated || 'Loading...');
    }

    updateLastUpdatedText(text) {
        if (this.lastUpdatedControl) {
            this.lastUpdatedControl.update(text);
        }
    }

    // 에러 메시지 표시 (이전과 동일)
    displayErrorMessage(message) {
        if (this.errorControl && this.map.hasControl(this.errorControl)) {
            this.map.removeControl(this.errorControl);
        }

        const ErrorControl = L.Control.extend({
            onAdd: function(map) {
                const div = L.DomUtil.create('div', 'error-message');
                div.innerHTML = message;
                return div;
            },
            onRemove: function(map) { /* Nothing to do */ }
        });

        this.errorControl = new ErrorControl({ position: 'topleft' });
        this.errorControl.addTo(this.map);

        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }

    // 맵 리셋 (이전과 동일)
    resetMap() {
        this.map.setView([37.8, -96], 4);
        if (this.filterControlInstance) {
            this.filterControlInstance.getContainer().querySelector('select').value = 'All';
            this.filterControlInstance.getContainer().querySelector('select').selectedIndex = 0;
        }
        this.renderMarkers(this.currentData);
    }

    // 혼잡도 레벨에 따라 필터링 (이전과 동일)
    filterByCongestion(level) {
        if (level === 'All' || !this.currentData) {
            this.renderMarkers(this.currentData);
        } else {
            const filtered = this.currentData.filter(item => item.congestion_level === level);
            this.renderMarkers(filtered);
        }
    }
}

window.RailCongestionMap = RailCongestionMap;
