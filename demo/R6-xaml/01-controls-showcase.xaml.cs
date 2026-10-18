<Window
    xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
    xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
    Title="控件总览"
    Width="560"
    Height="430">
    <Grid Margin="16">
        <Grid.RowDefinitions>
            <RowDefinition Height="Auto" />
            <RowDefinition Height="*" />
            <RowDefinition Height="Auto" />
        </Grid.RowDefinitions>

        <TextBlock
            Grid.Row="0"
            Margin="0,0,0,12"
            FontSize="18"
            FontWeight="Bold"
            Text="Wispkit XAML 渲染示例 · 控件总览1" />

        <StackPanel Grid.Row="1">
            <TextBlock Margin="0,0,0,10" Text="这一段用来检查正文行距与中文字形。" />

            <StackPanel Margin="0,0,0,10" Orientation="Horizontal">
                <Button Margin="0,0,8,0" Padding="6,4" Width="88" Content="确定" />
                <Button Margin="0,0,8,0" Padding="6,4" Width="88" Content="取消" />
                <Button Padding="6,4" Width="88" Content="应用" IsEnabled="False" />
            </StackPanel>

            <StackPanel Margin="0,0,0,10" Orientation="Horizontal">
                <CheckBox Margin="0,0,18,0" VerticalAlignment="Center" Content="启用缓存" IsChecked="True" />
                <RadioButton Margin="0,0,18,0" VerticalAlignment="Center" Content="模式 A" IsChecked="True" />
                <RadioButton VerticalAlignment="Center" Content="模式 B" />
            </StackPanel>

            <ComboBox
                Margin="0,0,0,10"
                Width="220"
                HorizontalAlignment="Left"
                SelectedIndex="0">
                <ComboBoxItem Content="选项一" />
                <ComboBoxItem Content="选项二" />
                <ComboBoxItem Content="选项三" />
            </ComboBox>

            <TextBox
                Margin="0,0,0,10"
                Padding="4"
                Width="280"
                HorizontalAlignment="Left"
                Text="可以直接输入的文本框" />

            <Slider
                Margin="0,0,0,10"
                Width="280"
                HorizontalAlignment="Left"
                Maximum="100"
                Minimum="0"
                Value="45" />

            <ProgressBar
                Width="280"
                Height="16"
                HorizontalAlignment="Left"
                Maximum="100"
                Minimum="0"
                Value="65" />
        </StackPanel>

        <StatusBar Grid.Row="2" Margin="0,12,0,0">
            <StatusBarItem>
                <TextBlock Text="就绪" />
            </StatusBarItem>
            <Separator />
            <StatusBarItem>
                <TextBlock Text="560 × 430" />
            </StatusBarItem>
        </StatusBar>
    </Grid>
</Window>
