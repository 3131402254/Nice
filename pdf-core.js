/* 发票 PDF 合并与排版核心逻辑（不依赖 DOM） */
(function (global) {
  'use strict';

  var PT_PER_MM = 72 / 25.4;
  var A5 = { width: 148 * PT_PER_MM, height: 210 * PT_PER_MM };

  function toNumber(value, fallback) {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function normalizeRotation(angle) {
    var a = toNumber(angle, 0);
    return ((a % 360) + 360) % 360;
  }

  /**
   * 读取页面可视区域。以 CropBox 为准（大多数发票与 MediaBox 相同）。
   */
  function getPageGeometry(page) {
    var crop = page.getCropBox();
    var box = crop && crop.width > 0 && crop.height > 0 ? crop : page.getMediaBox();
    var rotation = normalizeRotation(page.getRotation().angle);
    var turned = rotation === 90 || rotation === 270;
    return {
      box: box,
      width: box.width,
      height: box.height,
      rotation: rotation,
      displayWidth: turned ? box.height : box.width,
      displayHeight: turned ? box.width : box.height
    };
  }

  /**
   * 计算单页放在目标页面上的尺寸、缩放与位置。
   * layout: smart（不超过 100%，超出则等比缩小）| fill（等比铺满）| actual（1:1，页面随发票）
   */
  function computeLayout(geom, settings) {
    settings = settings || {};
    var margin = Math.max(0, toNumber(settings.marginMm, 2)) * PT_PER_MM;
    var pageWidth;
    var pageHeight;
    var scale;
    var offsetX;
    var offsetY;

    if (settings.layout === 'actual') {
      pageWidth = geom.displayWidth + margin * 2;
      pageHeight = geom.displayHeight + margin * 2;
      scale = 1;
      offsetX = margin;
      offsetY = margin;
    } else {
      var landscape;
      if (settings.orientation === 'landscape') {
        landscape = true;
      } else if (settings.orientation === 'portrait') {
        landscape = false;
      } else {
        landscape = geom.displayWidth > geom.displayHeight;
      }

      pageWidth = landscape ? A5.height : A5.width;
      pageHeight = landscape ? A5.width : A5.height;

      var availableWidth = Math.max(1, pageWidth - margin * 2);
      var availableHeight = Math.max(1, pageHeight - margin * 2);
      var fitScale = Math.min(
        availableWidth / geom.displayWidth,
        availableHeight / geom.displayHeight
      );

      if (!isFinite(fitScale) || fitScale <= 0) fitScale = 1;
      scale = settings.layout === 'fill' ? fitScale : Math.min(1, fitScale);

      var visualWidth = geom.displayWidth * scale;
      var visualHeight = geom.displayHeight * scale;
      offsetX = (pageWidth - visualWidth) / 2;
      offsetY = (pageHeight - visualHeight) / 2;
    }

    var drawWidth = geom.displayWidth * scale;
    var drawHeight = geom.displayHeight * scale;

    // drawPage 的旋转围绕 (drawX, drawY) 进行。按页面 /Rotate 反方向旋转，
    // 再平移，使旋转后的可视边界正好落在 offsetX / offsetY。
    var drawX = offsetX;
    var drawY = offsetY;
    if (geom.rotation === 90) {
      drawY = offsetY + drawHeight;
    } else if (geom.rotation === 180) {
      drawX = offsetX + drawWidth;
      drawY = offsetY + drawHeight;
    } else if (geom.rotation === 270) {
      drawX = offsetX + drawWidth;
    }

    return {
      pageWidth: pageWidth,
      pageHeight: pageHeight,
      scale: scale,
      offsetX: offsetX,
      offsetY: offsetY,
      drawWidth: drawWidth,
      drawHeight: drawHeight,
      drawX: drawX,
      drawY: drawY,
      drawRotate: -geom.rotation,
      rotation: geom.rotation
    };
  }

  function buildPagePlan(geom, settings) {
    var layout = computeLayout(geom, settings);
    return {
      sourceWidth: geom.width,
      sourceHeight: geom.height,
      sourceRotation: geom.rotation,
      sourceDisplayWidth: geom.displayWidth,
      sourceDisplayHeight: geom.displayHeight,
      cropBox: { x: geom.box.x, y: geom.box.y, width: geom.box.width, height: geom.box.height },
      pageWidth: layout.pageWidth,
      pageHeight: layout.pageHeight,
      scale: layout.scale,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
      drawWidth: layout.drawWidth,
      drawHeight: layout.drawHeight,
      drawX: layout.drawX,
      drawY: layout.drawY,
      drawRotate: layout.drawRotate,
      rotation: layout.rotation
    };
  }

  /**
   * 将多份 PDF 合并并逐页排版。
   * sources: [{ name, originalName, doc }]
   */
  async function buildMergedPdf(PDFLib, sources, options, onProgress) {
    if (!PDFLib || !PDFLib.PDFDocument) throw new Error('PDF 组件未加载');
    if (!sources || !sources.length) throw new Error('没有可合并的 PDF');

    options = options || {};
    var mode = options.mode === 'double' ? 'double' : 'single';
    var copyCount = mode === 'double' ? 2 : 1;
    var outDoc = await PDFLib.PDFDocument.create();

    var totalPages = 0;
    sources.forEach(function (source) {
      totalPages += source.doc.getPageCount() * copyCount;
    });

    var done = 0;
    var pageMeta = [];
    var progressTimer = 0;

    function report(force) {
      if (!onProgress) return;
      var now = Date.now();
      if (force || now - progressTimer > 80) {
        progressTimer = now;
        onProgress(done, totalPages);
      }
    }

    report(true);

    for (var s = 0; s < sources.length; s++) {
      var source = sources[s];
      var pages = source.doc.getPages();

      for (var p = 0; p < pages.length; p++) {
        var page = pages[p];
        var geom = getPageGeometry(page);
        var plan = buildPagePlan(geom, options);
        var embedded;

        try {
          embedded = await outDoc.embedPage(
            page,
            {
              left: geom.box.x,
              bottom: geom.box.y,
              right: geom.box.x + geom.box.width,
              top: geom.box.y + geom.box.height
            },
            [1, 0, 0, 1, -geom.box.x, -geom.box.y]
          );
        } catch (error) {
          var sourceLabel = source.originalName || source.name || '未知文件';
          throw new Error(
            '处理「' + sourceLabel + '」第 ' + (p + 1) + ' 页失败：' + (error && error.message ? error.message : error)
          );
        }

        for (var c = 0; c < copyCount; c++) {
          var outPage = outDoc.addPage([plan.pageWidth, plan.pageHeight]);
          outPage.drawPage(embedded, {
            x: plan.drawX,
            y: plan.drawY,
            width: plan.scale * geom.width,
            height: plan.scale * geom.height,
            rotate: PDFLib.degrees(plan.drawRotate)
          });

          pageMeta.push({
            pageNumber: pageMeta.length + 1,
            sourceName: source.name,
            originalName: source.originalName || source.name,
            sourcePage: p + 1,
            sourcePageCount: pages.length,
            copy: copyCount > 1 ? c + 1 : 0,
            copyCount: copyCount,
            pageWidth: plan.pageWidth,
            pageHeight: plan.pageHeight,
            scale: plan.scale,
            offsetX: plan.offsetX,
            offsetY: plan.offsetY,
            drawWidth: plan.drawWidth,
            drawHeight: plan.drawHeight,
            sourceWidth: plan.sourceWidth,
            sourceHeight: plan.sourceHeight,
            sourceDisplayWidth: plan.sourceDisplayWidth,
            sourceDisplayHeight: plan.sourceDisplayHeight,
            rotation: plan.rotation
          });

          done += 1;
          report(false);
        }

        // 让出主线程，保持界面响应
        await new Promise(function (resolve) { setTimeout(resolve, 0); });
      }
    }

    report(true);

    var now = new Date();
    outDoc.setTitle(options.title || '发票合并');
    outDoc.setCreator('发票打印助手');
    outDoc.setProducer('发票打印助手（pdf-lib）');
    outDoc.setCreationDate(now);
    outDoc.setModificationDate(now);

    var bytes = await outDoc.save();
    return {
      bytes: bytes,
      pageCount: pageMeta.length,
      pageMeta: pageMeta
    };
  }

  global.InvoicePdfCore = {
    PT_PER_MM: PT_PER_MM,
    A5: A5,
    getPageGeometry: getPageGeometry,
    computeLayout: computeLayout,
    buildPagePlan: buildPagePlan,
    buildMergedPdf: buildMergedPdf
  };
})(window);
