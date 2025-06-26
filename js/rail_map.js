class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40,
            disableClusteringAtZoom: 9,
            spiderfyOnMaxZoom: true,
            spiderfyDistanceMultiplier: 2,
            
            iconCreateFunction: (cluster) => {
                const childMarkers = cluster.getAllChildMarkers();
                let highestCongestionLevelValue = -1;
                let dominantColor = this.getColor('Average');

                const congestionLevelToValue = (level) => {
                    switch (level) {
                        case 'Very High': return 4;
                        case 'High': return 3;
                        case 'Low': return 2;
                        case 'Very Low': return 1;
                        default: return 0;
                    }
                };

                childMarkers.forEach(marker => {
                    const itemData = marker.options.itemData;
                    if (itemData && itemData.congestion_level) {
                        const currentLevelValue = congestionLevelToValue(itemData.congestion_level);
                        if (currentLevelValue > highestCongestionLevelValue) {
                            highestCongestionLevelValue = currentLevelValue;
                            dominantColor = this.getColor(itemData.congestion_level);
                        }
                    }
                });

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
        this.markerToOpenAfterMove = null;
        this.lastOpenedMarker = null;
        // this.isMarkerClickHandled = false; // 이 플래그는 제거하거나 다른 방식으로 관리하는 것이 좋습니다.

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180], // 남서쪽 경계
            [85, 180]    // 북동쪽 경계
        ]);

        this.loadData();

        this.map.on('popupopen', (e) => {
            if (e.popup && e.popup._source && e.popup._source instanceof L.Marker) {
                this.lastOpenedMarker = e.popup._source;
                console.log(`Popup for ${this.lastOpenedMarker.options.itemData.Yard} opened.`);
            }
        });

        this.map.on('popupclose', (e) => {
            console.log(`Popup for ${e.popup._source ? e.popup._source.options.itemData.Yard : 'unknown'} closed.`);
            if (this.lastOpenedMarker === e.popup._source) {
                this.lastOpenedMarker = null; // 닫힌 팝업의 마커를 lastOpenedMarker에서 제거
            }
        });

        // 맵 클릭 이벤트 핸들러 조정
        this.map.on('click', (e) => {
            // 마커 클릭 이벤트가 맵 클릭 이벤트보다 먼저 처리되므로,
            // 마커 팝업이 열려있거나 열릴 예정인 경우 맵 클릭은 무시
            if (this.lastOpenedMarker && this.lastOpenedMarker.getPopup().isOpen()) {
                console.log('Map click: A marker popup is already open. Ignoring.');
                return;
            }
            if (this.markerToOpenAfterMove) { // 이동 후 팝업을 열기 위해 대기중인 경우
                console.log('Map click: Waiting to open a marker popup. Ignoring.');
                return;
            }
            // 맵 배경 클릭 시 기존 팝업 닫기
            console.log('Map background clicked. Closing any open popups.');
            this.map.closePopup();
            this.lastOpenedMarker = null;
        });


        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const yardName = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // 초기화
                this.pollForMarkerAndOpenPopup(yardName);
            }
        });
    }

    pollForMarkerAndOpenPopup(yardName) {
        let targetMarker = null;
        // 클러스터 그룹 내에서 마커를 찾을 때, 클러스터링 때문에 바로 보이지 않을 수 있으므로
        // `getVisibleParent`를 사용하여 실제 마커 또는 클러스터 마커를 찾아야 할 수도 있습니다.
        // 여기서는 `eachLayer`를 통해 클러스터링된 경우에도 개별 마커를 찾아봅니다.
        this.allMarkers.eachLayer(layer => {
            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                targetMarker = layer;
                return; // Leaflet eachLayer의 return은 break 역할
            }
        });

        if (!targetMarker) {
            console.warn(`pollForMarkerAndOpenPopup: Marker for yard '${yardName}' not found in current layers (might be in a cluster).`);
            // 마커가 아직 클러스터 내에 있거나 DOM에 추가되지 않았을 수 있으므로 재시도 로직 필요
            return;
        }

        // 팝업이 이미 마커에 바인딩되어 있는지 확인
        if (!targetMarker.getPopup()) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker or no popup associated.");
            return;
        }

        // 기존 팝업 닫기
        this.map.closePopup();

        let attempts = 0;
        const maxAttempts = 30; // 충분한 시도 횟수
        const retryInterval = 100; // 100ms 간격으로 재시도

        const checkAndOpen = () => {
            // 마커의 _icon이 DOM에 추가되었고, 맵에 속해 있는지 확인
            if (targetMarker._icon && targetMarker._map) {
                console.log(`Poll success for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}). Opening popup.`);
                // 마커에 직접 openPopup 호출 시도
                targetMarker.openPopup(); 
                
                // 팝업이 실제로 열렸는지 확인
                if (targetMarker.getPopup().isOpen()) {
                    console.log(`Popup for ${targetMarker.options.itemData.Yard} successfully confirmed open.`);
                } else {
                    // 마커의 openPopup이 실패했을 경우, 맵의 openPopup을 통해 강제로 열기 시도
                    console.warn(`Popup for ${targetMarker.options.itemData.Yard} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(targetMarker.getPopup());
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${targetMarker.options.itemData.Yard} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${targetMarker.options.itemData.Yard} after max polling attempts.`);
            }
        };
        
        setTimeout(checkAndOpen, 50); // 약간의 지연 후 첫 시도
    }

    async loadData() {
        try {
            const response = await fetch('data/us-rail.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const rawData = await response.json();

            let processedData = rawData.map(item => ({
                lat: parseFloat(item.lat || item.Latitude),
                lng: parseFloat(item.lng || item.Longitude),
                Yard: item.location || item.Yard || item.Location || 'Unknown',
                location: item.location || item.Yard || item.Location || 'Unknown Location',
                company: item.company || item.Railroad || 'Unknown',
                congestion_score: parseFloat(item.congestion_score || item.DwellTime),
                indicator: parseFloat(item.indicator || item.Indicator),
                congestion_level: item.congestion_level || item.Category || 'Average',
                date: item.date || item.DateMonth
            })).filter(item =>
               !isNaN(item.lat) && !isNaN(item.lng) && item.location && item.congestion_level
            );

            const coordinateMap = new Map();

            processedData.forEach(item => {
                const coordKey = `${item.lat},${item.lng}`;
                if (!coordinateMap.has(coordKey)) {
                    coordinateMap.set(coordKey, []);
                }
                coordinateMap.get(coordKey).push(item);
            });

            const jitteredData = [];
            coordinateMap.forEach(itemsAtCoord => {
                if (itemsAtCoord.length > 1) {
                    const baseLat = itemsAtCoord[0].lat;
                    const baseLng = itemsAtCoord[0].lng;
                    
                    const offsetScale = 0.0005; // 0.1은 너무 클 수 있습니다. 더 작은 값으로 조정

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        // Jittering을 위도, 경도 모두에 적용
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale * Math.random());
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale * Math.random());

                        item.lat = jitterLat;
                        item.lng = jitterLng;
                        jitteredData.push(item);
                    });
                } else {
                    jitteredData.push(itemsAtCoord[0]);
                }
            });

            this.currentData = jitteredData;

            if (this.currentData.length > 0) {
                this.lastUpdated = this.currentData[0].date;
            }

            this.renderMarkers();
            this.addRightControls();
            this.addLastUpdatedText();
            // this.addLegend(); // 주석 해제하여 범례 추가 가능

        } catch (error) {
            console.error("Failed to load rail data:", error);
            this.displayErrorMessage("Failed to load rail data. Please try again later.");
        }
    }
    
    renderMarkers(data = this.currentData) {
        if (!data || data.length === 0) {
            console.warn("No data provided to renderMarkers or data is empty. Clearing map layers.");
            this.allMarkers.clearLayers();
            if (this.map.hasLayer(this.allMarkers)) {
                this.map.removeLayer(this.allMarkers);
            }
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
        
        // 클러스터 클릭 이벤트 재정의
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });

        // 클러스터 마우스오버/아웃 팝업 (데스크톱 전용)
        if (!L.Browser.mobile) {
            this.allMarkers.off('clustermouseover');
            this.allMarkers.on('clustermouseover', (a) => {
                const clusterItems = a.layer.getAllChildMarkers().map(m => m.options.itemData);
                const childCount = clusterItems.length;

                // 팝업 내용
                const popupContent = `
                    <div class="cluster-hover-info">
                        <h4>${childCount} Locations Clustered</h4>
                        <p>Click or zoom in to see individual details.</p>
                    </div>
                `;

                // 팝업 생성 및 열기
                L.popup({
                    closeButton: false,
                    autoClose: true,
                    closeOnClick: false,
                    maxHeight: 300,
                    maxWidth: 300,
                    className: 'cluster-hover-popup' // 커스텀 클래스 추가
                })
               .setLatLng(a.latlng)
               .setContent(popupContent)
               .openOn(this.map);
            });

            this.allMarkers.off('clustermouseout');
            this.allMarkers.on('clustermouseout', () => {
                this.map.closePopup();
            });
        }
    }

    createSingleMarker(item) {
        const level = item.congestion_level || 'Average';
        const color = this.getColor(level);
        const radius = this.getRadiusByIndicator(item.indicator);

        const iconHtml = `
            <div style="
                background-color: ${color};
                width: ${radius * 2}px;
                height: ${radius * 2}px;
                border-radius: 50%;
                border: 1.5px solid white;
                box-shadow: 0 0 3px rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
            "></div>
        `;

        const customIcon = L.divIcon({
            className: 'custom-div-icon',
            html: iconHtml,
            iconSize: [radius * 2, radius * 2],
            iconAnchor: [radius, radius]
        });

        const marker = L.marker([item.lat, item.lng], {
            icon: customIcon,
            itemData: item // 원본 데이터를 마커 옵션에 저장
        });

        const popupOptions = {
            closeButton: true,
            autoClose: false, // 마커 클릭시 닫히지 않고, 맵 배경 클릭시만 닫히도록 변경
            closeOnClick: false, // 맵 배경 클릭 시 닫히도록 변경
            maxHeight: 300,
            maxWidth: 300,
            className: 'single-marker-popup' // 개별 마커 팝업 클래스 추가
        };

        // 개별 마커의 팝업은 해당 마커의 데이터만 사용합니다.
        marker.bindPopup(this.createPopupContent([item]), popupOptions); 
        
        // 개별 마커 툴팁 (마우스 오버 시)
        if (!L.Browser.mobile) {
            marker.bindTooltip(`Yard: ${item.Yard}<br>Level: ${item.congestion_level}`, {
                permanent: false,
                direction: 'top',
                offset: L.point(0, -radius),
                className: 'custom-marker-tooltip'
            });
        }

        // 팝업 열릴 때 z-index 조정 및 클릭/스크롤 전파 방지
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened.`);
            e.popup.getElement().style.zIndex = 10000;
            const popupDiv = e.popup.getElement();
            if (popupDiv) {
                L.DomEvent.disableClickPropagation(popupDiv);
                L.DomEvent.disableScrollPropagation(popupDiv);
            }
            this.lastOpenedMarker = e.target; // 현재 열린 마커를 저장
        });

        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
            if (this.lastOpenedMarker === e.target) {
                this.lastOpenedMarker = null; // 닫힌 팝업의 마커를 lastOpenedMarker에서 제거
            }
        });

        // 마커 클릭 시 동작 정의
        marker.on('click', (e) => {
            // this.isMarkerClickHandled = true; // 더 이상 필요 없음
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);
            
            // 다른 팝업이 열려있다면 닫기
            this.map.closePopup();
            
            // 클릭된 마커가 팝업을 열도록 시도
            // `zoomToShowLayer`는 마커가 클러스터에 숨어있을 때 유용합니다.
            // 이미 맵에 표시되어 있다면 즉시 팝업을 열 수 있습니다.
            if (this.allMarkers.hasLayer(marker)) { // 마커가 클러스터 그룹에 속해 있다면
                this.allMarkers.zoomToShowLayer(marker, () => {
                    // zoomToShowLayer 완료 후 팝업 열기
                    marker.openPopup();
                    console.log(`Popup for ${item.Yard} opened after zoomToShowLayer.`);
                    if (!marker.getPopup().isOpen()) {
                        console.warn("Popup did not confirm open after direct call. Trying map.openPopup.");
                        this.map.openPopup(marker.getPopup());
                    }
                });
            } else {
                // 마커가 클러스터링되지 않은 상태라면 바로 팝업 열기
                marker.openPopup();
                console.log(`Popup for ${item.Yard} opened directly.`);
                if (!marker.getPopup().isOpen()) {
                    console.warn("Popup did not confirm open after direct call (not in cluster). Trying map.openPopup.");
                    this.map.openPopup(marker.getPopup());
                }
            }
        });

        return marker;
    }

    // 팝업 내용 생성 함수 (클러스터 또는 개별 마커 모두 사용)
    createPopupContent(items) {
        const safeItems = Array.isArray(items) ? items : [items];
        let content = '';
        
        if (safeItems.length === 0) {
            return '<p>No valid data to display for this location.</p>';
        }

        // 단일 마커 팝업일 경우, 헤더 없이 바로 내용 시작
        // 여러 마커(클러스터 해제 시) 팝업일 경우, 헤더 추가
        const isMultiple = safeItems.length > 1;

        if (isMultiple) {
            content += `<div class="cluster-popup-header">
                            <h4>${safeItems.length} Locations</h4>
                            <p>Showing individual details:</p>
                           </div>
                           <div class="cluster-popup-content">`;
        }
        
        safeItems.forEach(item => {
            // 데이터 유효성 다시 확인
            if (!item || typeof item !== 'object' || typeof item.lat === 'undefined' || typeof item.lng === 'undefined') {
                console.warn("Skipping invalid or incomplete item in popup content:", item);
                return;
            }
        
            const level = item.congestion_level || 'Unknown';
            const company = item.company || 'Unknown';
            const location = item.location || 'Unknown Location';
            const congestionScore = (typeof item.congestion_score === 'number' && !isNaN(item.congestion_score)) ? item.congestion_score.toFixed(1) : 'N/A';
        
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
        
        return content || '<p>No valid data to display for this location.</p>';
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
                    <option value="" disabled selected hidden>Select Yard</option>
                    <option value="All">All Yards</option>
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
                if (yardName === "All") {
                    console.log("Filter: All Yards selected. Resetting view.");
                    this.map.setView([37.8, -96], 4);
                    this.map.closePopup();
                    this.markerToOpenAfterMove = null;
                } else if (yardName) {
                    console.log(`Filter selected: ${yardName}`);
                    const yardDataForFilter = this.currentData.filter(item => item.Yard === yardName);
                    if (yardDataForFilter.length > 0) {
                        let foundMarker = null;
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.Yard === yardName) {
                                foundMarker = layer;
                                return;
                            }
                        });

                        if (foundMarker) {
                            console.log(`Found marker for filter: ${yardName}. Using zoomToShowLayer.`);
                            this.map.closePopup(); // 다른 팝업 먼저 닫기
                            this.allMarkers.zoomToShowLayer(foundMarker, () => {
                                // zoomToShowLayer가 완료되면 팝업 열기
                                foundMarker.openPopup();
                                console.log(`Popup for ${yardName} opened after zoomToShowLayer.`);
                                if (!foundMarker.getPopup().isOpen()) {
                                    // 확실하게 열기 위해 map.openPopup 시도
                                    console.warn(`Popup for ${yardName} did not confirm open after direct call. Final retry via map.`);
                                    this.map.openPopup(foundMarker.getPopup());
                                }
                            });
                            this.markerToOpenAfterMove = null; // 성공적으로 처리했으므로 초기화
                        } else {
                            console.warn(`Marker object for yard '${yardName}' not immediately found. Falling back to fitBounds and polling.`);
                            const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                            this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 });
                            this.markerToOpenAfterMove = yardName; // moveend 후 열기 위해 야드 이름 저장
                        }
                    } else {
                        console.warn(`No data found for yard '${yardName}'.`);
                    }
                }
            });

            div.querySelector('.rail-reset-btn').addEventListener('click', () => {
                console.log("Reset button clicked.");
                this.map.setView([37.8, -96], 4);
                this.map.closePopup();
                this.markerToOpenAfterMove = null;
                const yardFilter = div.querySelector('.yard-filter');
                if (yardFilter) {
                    yardFilter.value = '';
                    yardFilter.selectedIndex = 0;
                }
            });

            L.DomEvent.disableClickPropagation(div);
            L.DomEvent.disableScrollPropagation(div);

            this.filterControlInstance = control;
            return div;
        };

        control.addTo(this.map);
    }

    addLegend() {
        const legend = L.control({ position: 'bottomright' });

        legend.onAdd = function (map) {
            const div = L.DomUtil.create('div', 'info legend');
            const levels = ['Very High', 'High', 'Low', 'Very Low', 'Average'];
            const labels = [];

            for (let i = 0; i < levels.length; i++) {
                const level = levels[i];
                const color = this.getColor(level);

                labels.push(
                    `<i style="background:${color}"></i> ${level}`
                );
            }

            div.innerHTML = '<h4>Congestion Level</h4>' + labels.join('<br>');
            return div;
        }.bind(this);

        legend.addTo(this.map);
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
            'Average': '#bcbcbc',
            'Unknown': '#bcbcbc'
        };

        const textColors = {
            'Very High': '#6b1414',
            'High': '#7c4616',
            'Low': '#30557b',
            'Very Low': '#002860',
            'Average': '#5e5e5e',
            'Unknown': '#5e5e5e'
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

        setTimeout(() => {
            if (this.map.hasControl(this.errorControl)) {
                this.map.removeControl(this.errorControl);
            }
        }, 5000);
    }
}

// RailCongestionMap 클래스를 전역 스코프에 노출합니다.
window.RailCongestionMap = RailCongestionMap;
