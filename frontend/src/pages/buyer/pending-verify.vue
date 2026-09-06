<!--
  采购方·待审核状态页
  对应原型 data-page="pendingVerify"
  注册提交后自动跳到此页；用户在等待核实期间可补传资料、催办、查看商品预览
-->
<template>
  <view class="container">
    <view class="hero">
      <text class="big-emoji">⏳</text>
      <text class="title" style="color:#FF8F1F;">账号审核中</text>
      <text class="sub">业务员将在 <text class="hl">24 小时内</text> 通过电话或上门方式核实您的餐馆真实情况，请保持手机畅通</text>
    </view>

    <view class="card">
      <text class="card-title">📝 审核进度</text>
      <view class="steps">
        <view class="step done"><view class="dot"/><view class="lbl">资料提交<br><text class="ts">今天 09:23</text></view></view>
        <view class="step active"><view class="dot"/><view class="lbl">业务员核实中<br><text class="ts">预计 24 小时内</text></view></view>
        <view class="step"><view class="dot"/><view class="lbl">账号激活<br><text class="ts">通过后即可下单</text></view></view>
      </view>
    </view>

    <view class="card">
      <text class="tips">💡 <text class="b">审核期间您可以：</text>\n· 完善餐馆资料（营业执照等可随时补传）\n· 查看菜品分类和价格（暂不可下单）\n\n❌ <text class="b">暂不可用：</text>下单、加入购物车、付款</text>
    </view>

    <view class="btn-row">
      <button class="lk-btn" @tap="$emit('uploadMore')">📎 补充资料</button>
      <button class="lk-btn" @tap="previewGoods">🥬 商品预览</button>
    </view>
    <view class="footer-tip">已超过 24 小时？<text class="link" @tap="urge">催办</text> · 联系客服 400-XXX-XXXX</view>
  </view>
</template>

<script setup>
const urge = () => { uni.request({ url:'/api/buyer/urge-verify', method:'POST', success:()=> uni.showToast({title:'已催办，运营将在 1 小时内介入'}) }) }
const previewGoods = () => { uni.showToast({title:'商品预览仅供查看，暂不可下单',icon:'none'}); uni.switchTab({ url:'/pages/buyer/goods' }) }
</script>