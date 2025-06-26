class RailCongestionMap {
    constructor(mapElementId) {
        this.map = L.map(mapElementId).setView([37.8, -96], 4);
        
        this.allMarkers = L.markerClusterGroup({
            maxClusterRadius: 40, 
            disableClusteringAtZoom: 9, 
            spiderfyOnMaxZoom: true, 
            
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
        this.markerToOpenAfterMove = null; // 필터링 후 팝업을 열 마커를 저장하는 속성

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
            maxZoom: 18,
            minZoom: 3
        }).addTo(this.map);

        this.map.setMaxBounds([
            [-85, -180],
            [85, 180]
        ]);

        this.loadData();

        // 맵 클릭 시 열려 있는 팝업 닫기 (마커 클릭 이벤트와 버블링 충돌 방지 위해 L.DomEvent.stopPropagation 중요)
        this.map.on('click', () => {
            console.log("Map clicked. Closing any open popups.");
            this.map.closePopup(); 
        });

        // 맵 이동/확대/축소 완료 시 필터링된 마커의 팝업 열기 시도
        this.map.on('moveend', () => {
            if (this.markerToOpenAfterMove) {
                console.log('Map animation ended, attempting to open queued popup with polling.');
                const targetMarker = this.markerToOpenAfterMove;
                this.markerToOpenAfterMove = null; // 큐에서 마커 제거
                this.pollForMarkerAndOpenPopup(targetMarker);
            }
        });
        
        // MarkerClusterGroup의 layeradd 이벤트를 사용하여 마커가 실제로 지도에 추가될 때 팝업 열기 시도
        // (이 로직은 pollForMarkerAndOpenPopup이 마커의 DOM 요소를 찾지 못할 경우의 폴백 역할을 할 수 있지만,
        //  pollForMarkerAndOpenPopup이 더 직접적으로 DOM 준비를 확인하므로 주된 역할은 아닐 수 있음)
        this.allMarkers.on('layeradd', (e) => {
            const addedLayer = e.layer;
            // markerToOpenAfterMove가 설정되어 있고, 추가된 레이어가 해당 마커인 경우
            if (this.markerToOpenAfterMove && addedLayer.options.itemData && this.markerToOpenAfterMove.options.itemData.Yard === addedLayer.options.itemData.Yard) {
                console.log(`Layer added for queued marker: ${addedLayer.options.itemData.Yard}. Attempting to open popup.`);
                // pollForMarkerAndOpenPopup이 이미 실행 중일 수 있으므로, 여기서는 한 번만 실행되도록 주의 필요
                // moveend에서 처리되도록 markerToOpenAfterMove를 null로 설정했으므로 중복 호출은 줄어들 것임.
                // 다만, layeradd는 클러스터 내 마커들이 개별적으로 보여질 때 발생하므로, 폴링 시작 트리거로도 유용함.
                this.pollForMarkerAndOpenPopup(addedLayer); 
                this.markerToOpenAfterMove = null; // 큐에서 마커 제거 (중복 방지)
            }
        });
    }

    // 마커가 DOM에 완전히 렌더링될 때까지 폴링하여 팝업 열기
    pollForMarkerAndOpenPopup(marker) {
        if (!marker || !marker.getPopup() || !marker.options.itemData) {
            console.warn("pollForMarkerAndOpenPopup: Invalid marker, no popup, or no itemData associated.");
            return;
        }

        this.map.closePopup(); // 다른 팝업 닫기

        let attempts = 0;
        const maxAttempts = 50; // 재시도 횟수 더 증가 (예: 30 -> 50)
        const retryInterval = 150; // 재시도 간격 더 증가 (예: 100 -> 150)

        const checkAndOpen = () => {
            // 마커의 _icon (실제 DOM 요소)이 존재하고, 마커가 지도에 있는지 확인
            // _map은 마커가 지도에 추가되었는지를 의미
            if (marker._icon && marker._map) { 
                console.log(`Poll success for ${marker.options.itemData.Yard} (Attempt ${attempts + 1}). Opening popup.`);
                marker.openPopup();
                if (marker.getPopup().isOpen()) {
                    console.log(`Popup for ${marker.options.itemData.Yard} successfully confirmed open.`);
                } else {
                    console.warn(`Popup for ${marker.options.itemData.Yard} did not confirm open after direct call. Final retry via map.`);
                    this.map.openPopup(marker.getPopup()); // 폴백 (fallback)
                }
            } else if (attempts < maxAttempts) {
                console.log(`Polling for ${marker.options.itemData.Yard} (Attempt ${attempts + 1}): Marker not ready. Retrying...`);
                attempts++;
                setTimeout(checkAndOpen, retryInterval);
            } else {
                console.error(`Failed to open popup for ${marker.options.itemData.Yard} after max polling attempts.`);
            }
        };
        
        // 폴링 시작 전 초기 지연을 주어 지도 렌더링 시간을 확보
        setTimeout(checkAndOpen, 50); 
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
                congestion_score: parseFloat(item.congestion_score || item['Dwell Time']),
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
                    
                    const offsetScale = 0.1; 

                    itemsAtCoord.forEach((item, index) => {
                        const angle = (index / itemsAtCoord.length) * 2 * Math.PI;
                        const jitterLat = baseLat + (Math.cos(angle) * offsetScale);
                        const jitterLng = baseLng + (Math.sin(angle) * offsetScale);

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
            // this.addLegend(); 

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
        
        this.allMarkers.off('clusterclick');
        this.allMarkers.on('clusterclick', (a) => {
            console.log("Cluster clicked, zooming to bounds.");
            a.layer.zoomToBounds();
        });

        // 클러스터 마우스 오버/아웃 로직 제거 (MarkerClusterGroup과 충돌 가능성, 불필요)
        // 기존 코드:
        // if (!L.Browser.mobile) {
        //     this.allMarkers.off('clustermouseover');
        //     this.allMarkers.on('clustermouseover', (a) => { ... });
        //     this.allMarkers.off('clustermouseout');
        //     this.allMarkers.on('clustermouseout', () => { ... });
        // }
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
            itemData: item 
        });

        const popupOptions = {
            closeButton: true,
            autoClose: true, 
            closeOnClick: true, 
            maxHeight: 300,
            maxWidth: 300,
            autoPan: false // 이 줄을 추가합니다. (필터 시 fitBounds와 충돌 방지)
        };

        // 팝업 내용 바인딩
        marker.bindPopup(this.createPopupContent([item]), popupOptions);
        
        // 팝업 열림/닫힘 시 콘솔 로그 (디버깅용)
        marker.on('popupopen', (e) => {
            console.log(`Popup for ${item.Yard} just opened.`);
            e.popup.getElement().style.zIndex = 10000; // 팝업을 맨 위로
        });
        marker.on('popupclose', (e) => {
            console.log(`Popup for ${item.Yard} just closed.`);
        });

        // PC 전용 호버 로직
        if (!L.Browser.mobile) {
            marker.on('mouseover', () => {
                console.log("PC: Mouseover on marker.");
                this.map.closePopup(); // 다른 팝업 먼저 닫기
                marker.openPopup();
            });
            // 마우스가 마커나 팝업 영역을 벗어나면 팝업 닫기
            marker.on('mouseout', (e) => { // e를 인자로 받음
                console.log("PC: Mouseout from marker.");
                const popupElement = marker.getPopup().getElement();
                // 마우스가 팝업 요소 위에 여전히 있는지 확인
                // e.originalEvent.relatedTarget는 마우스가 벗어난 후 도착한 요소를 나타냄
                if (!popupElement || !popupElement.contains(e.originalEvent.relatedTarget)) {
                    setTimeout(() => { // 짧은 지연으로 안정성 확보
                        if (marker.getPopup() && marker.getPopup().isOpen()) {
                            marker.closePopup();
                        }
                    }, 50); 
                }
            });
        }
        
        // PC 및 모바일 공통 클릭/탭 로직
        marker.on('click', (e) => { 
            L.DomEvent.stopPropagation(e); // 맵의 클릭/탭 이벤트 전파 방지 (가장 중요!)
            console.log(`Clicked/Tapped marker: ${item.Yard}. Current popup state: ${marker.getPopup().isOpen()}`);
            
            // 팝업 토글: 열려있으면 닫고, 닫혀있으면 열기
            if (marker.getPopup().isOpen()) {
                marker.closePopup();
            } else {
                this.map.closePopup(); // 다른 팝업 먼저 닫기
                // 모바일 터치 안정성 확보를 위한 짧은 지연 추가 (클릭/탭 후 바로 열릴 수 있도록)
                setTimeout(() => {
                    if (marker && marker._map) { // 마커가 지도에 있는지 다시 확인
                        marker.openPopup();
                        if (!marker.getPopup().isOpen()) {
                            console.warn("Mobile/Click: Popup did not open immediately, trying map.openPopup as fallback.");
                            this.map.openPopup(marker.getPopup()); // 마지막 폴백
                        }
                    } else {
                        console.warn("Mobile/Click: Marker not available for popup after delay.");
                    }
                }, 100); 
            }
        });

        return marker;
    }

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
                        const bounds = L.latLngBounds(yardDataForFilter.map(item => [item.lat, item.lng]));
                        
                        console.log(`Fitting map to bounds: ${bounds.toBBoxString()}`);
                        // 마커가 클러스터링되지 않고 개별적으로 보이도록 disableClusteringAtZoom + 1 보다 높은 줌 레벨로 맞춤
                        this.map.fitBounds(bounds.pad(0.5), { maxZoom: this.allMarkers.options.disableClusteringAtZoom + 1 }); 
                        
                        let foundMarkerForFilter = null;
                        // 모든 개별 마커를 확인하여 필터링된 야드에 해당하는 마커를 찾음
                        // 주의: getLayers()는 현재 지도에 추가된 개별 마커만 반환합니다.
                        // 클러스터링된 마커는 직접 접근하기 어렵습니다.
                        // 이 경우, this.currentData에서 마커 데이터를 찾아서 사용하는 것이 더 안정적입니다.
                        const targetItemData = yardDataForFilter[0]; // 필터된 첫 번째 데이터 항목 사용
                        
                        // 현재 지도에 있는 마커들 중에서 찾는 대신, 기존의 allMarkers에서 찾거나 새로 생성할 수 있습니다.
                        // 여기서는 this.allMarkers 레이어들을 직접 순회하여 정확한 L.Marker 객체를 찾습니다.
                        this.allMarkers.eachLayer(layer => {
                            if (layer.options.itemData && layer.options.itemData.Yard === targetItemData.Yard) {
                                foundMarkerForFilter = layer;
                                console.log(`Found marker object for filter: ${yardName}`);
                                return false; // eachLayer 순회 중단
                            }
                        });

                        // 찾은 마커를 맵 이동 후 팝업을 열기 위한 큐에 저장
                        this.markerToOpenAfterMove = foundMarkerForFilter;
                        if (!foundMarkerForFilter) {
                            console.warn(`No individual marker object found for yard '${yardName}' after filter selection. Pop-up may not open.`);
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
                yardFilter.value = ""; // 드롭다운 리셋
            });
            return div;
        };
        control.addTo(this.map);
        this.filterControlInstance = control;
    }
    
    // 추가 함수 (예: getColor, getRadiusByIndicator, displayErrorMessage)는 기존과 동일하게 유지됩니다.
    // 편의를 위해 여기에 다시 포함합니다.
    getColor(level, isText = false) {
        if (isText) {
            switch (level) {
                case 'Very High': return '#D32F2F'; // Red
                case 'High': return '#F57C00';    // Orange
                case 'Low': return '#FFEB3B';     // Yellow
                case 'Very Low': return '#4CAF50';  // Green
                default: return '#757575';         // Gray (Average/Unknown)
            }
        } else {
            switch (level) {
                case 'Very High': return '#D32F2F';
                case 'High': return '#F57C00';
                case 'Low': return '#FFEB3B';
                case 'Very Low': return '#4CAF50';
                default: return '#757575';
            }
        }
    }

    getRadiusByIndicator(indicator) {
        if (indicator < 10) return 5;
        if (indicator < 20) return 7;
        if (indicator < 30) return 9;
        if (indicator < 40) return 11;
        return 13;
    }

    displayErrorMessage(message) {
        if (this.errorControl) {
            this.map.removeControl(this.errorControl);
        }
        const errorControl = L.control({ position: 'topleft' });
        errorControl.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'error-message');
            div.innerHTML = `<p>${message}</p>`;
            return div;
        };
        errorControl.addTo(this.map);
        this.errorControl = errorControl;
        setTimeout(() => {
            if (this.errorControl) {
                this.map.removeControl(this.errorControl);
                this.errorControl = null;
            }
        }, 5000); // 5초 후 메시지 제거
    }
}

// 전역 스코프에 RailCongestionMap 클래스 노출
window.RailCongestionMap = RailCongestionMap;
